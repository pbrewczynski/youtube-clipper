#!/usr/bin/env python3
import http.server
import socketserver
import json
import subprocess
import os
import sqlite3
import tempfile
import shutil
import glob

PORT = 5005
FIREFOX_PROFILE_NAME = os.environ.get("FIREFOX_PROFILE", "Beyond")


def resolve_firefox_profile_path(profile_name: str) -> str | None:
    """Resolve a Firefox profile display name to its Profiles/… folder suffix."""
    firefox_support = os.path.expanduser("~/Library/Application Support/Firefox")
    profile_groups_dir = os.path.join(firefox_support, "Profile Groups")

    for db_path in glob.glob(os.path.join(profile_groups_dir, "*.sqlite")):
        try:
            with sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    "SELECT path FROM Profiles WHERE name = ?",
                    (profile_name,),
                ).fetchone()
                if row:
                    return row[0].removeprefix("Profiles/")
        except sqlite3.Error:
            continue

    profiles_ini = os.path.join(firefox_support, "profiles.ini")
    if not os.path.isfile(profiles_ini):
        return None

    current_name = None
    current_path = None
    with open(profiles_ini, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("Name="):
                current_name = line.removeprefix("Name=")
            elif line.startswith("Path="):
                current_path = line.removeprefix("Path=")
            elif not line and current_name == profile_name and current_path:
                return current_path.removeprefix("Profiles/")
            elif line.startswith("[") and current_name == profile_name and current_path:
                return current_path.removeprefix("Profiles/")

    if current_name == profile_name and current_path:
        return current_path.removeprefix("Profiles/")

    return None


def build_cookies_arg(profile_name: str) -> list[str]:
    profile_path = resolve_firefox_profile_path(profile_name)
    if not profile_path:
        print(f"Warning: Firefox profile '{profile_name}' not found; continuing without cookies")
        return []

    print(f"Using Firefox cookies from profile '{profile_name}' ({profile_path})")
    return ["--cookies-from-browser", f"firefox:{profile_path}"]

class BridgeHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/trim':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)

            video_id = data.get('videoId')
            start = data.get('start', 0)
            end = data.get('end', 10)
            filename = data.get('filename', 'clip.mp4')
            duration = data.get('duration')

            if not video_id:
                self.send_error(400, "Missing videoId")
                return

            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()

            url = f"https://www.youtube.com/watch?v={video_id}"
            
            CACHE_DIR = os.path.expanduser("~/.cache/youtube-clipper")
            os.makedirs(CACHE_DIR, exist_ok=True)
            
            valid_extensions = {".mp4", ".mkv", ".webm", ".m4v"}
            cached_file = None
            for f in glob.glob(os.path.join(CACHE_DIR, f"{video_id}.*")):
                ext = os.path.splitext(f)[1].lower()
                if ext in valid_extensions:
                    cached_file = f
                    break

            try:
                downloads_path = os.path.expanduser("~/Downloads")
                final_path = os.path.join(downloads_path, filename)

                if cached_file:
                    print(f"Cache hit! Found cached full video for {video_id} at {cached_file}")
                    with tempfile.TemporaryDirectory() as tmpdir:
                        produced_file = os.path.join(tmpdir, "sliced.mp4")
                        
                        # Use ffmpeg to slice and re-encode to clean MP4
                        ffmpeg_cmd = [
                            "ffmpeg", "-y",
                            "-ss", str(start),
                            "-to", str(end),
                            "-i", cached_file,
                            "-c:v", "libx264",
                            "-c:a", "aac",
                            "-preset", "veryfast",
                            "-crf", "22",
                            produced_file
                        ]
                        print(f"Running ffmpeg: {' '.join(ffmpeg_cmd)}")
                        subprocess.run(ffmpeg_cmd, check=True)
                        
                        shutil.move(produced_file, final_path)
                        response = {"success": True, "path": final_path, "cached": True}
                        self.wfile.write(json.dumps(response).encode())
                        return

                # If not cached, check if we are downloading the entire video
                is_entire = False
                if duration is not None:
                    clip_len = end - start
                    # If clip length covers at least 98% of duration or start/end covers the full video
                    if clip_len >= duration - 2 or (start == 0 and end >= duration - 2):
                        is_entire = True

                if is_entire:
                    print(f"Downloading entire video for {video_id} to cache...")
                    output_template = os.path.join(CACHE_DIR, f"{video_id}.%(ext)s")
                    cmd = [
                        "yt-dlp",
                        *build_cookies_arg(FIREFOX_PROFILE_NAME),
                        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                        "-o", output_template,
                        url
                    ]
                    print(f"Running: {' '.join(cmd)}")
                    subprocess.run(cmd, check=True)

                    # Find the downloaded file
                    new_cached_file = None
                    for f in glob.glob(os.path.join(CACHE_DIR, f"{video_id}.*")):
                        ext = os.path.splitext(f)[1].lower()
                        if ext in valid_extensions:
                            new_cached_file = f
                            break

                    if not new_cached_file:
                        raise Exception("yt-dlp completed but cached file not found")

                    # Copy it to Downloads folder
                    shutil.copy2(new_cached_file, final_path)
                    response = {"success": True, "path": final_path, "cached": True}
                    self.wfile.write(json.dumps(response).encode())
                else:
                    # Download section only (no caching of full video)
                    print(f"Downloading section {start}-{end} for {video_id}...")
                    section = f"*{start}-{end}"
                    with tempfile.TemporaryDirectory() as tmpdir:
                        output_template = os.path.join(tmpdir, "out.%(ext)s")
                        cmd = [
                            "yt-dlp",
                            *build_cookies_arg(FIREFOX_PROFILE_NAME),
                            "--download-sections", section,
                            "--force-keyframes-at-cuts",
                            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                            "-o", output_template,
                            url
                        ]
                        print(f"Running: {' '.join(cmd)}")
                        subprocess.run(cmd, check=True)

                        files = os.listdir(tmpdir)
                        if not files:
                            raise Exception("yt-dlp produced no files")

                        produced_file = os.path.join(tmpdir, files[0])
                        shutil.move(produced_file, final_path)
                        response = {"success": True, "path": final_path, "cached": False}
                        self.wfile.write(json.dumps(response).encode())

            except Exception as e:
                print(f"Error: {e}")
                response = {"success": False, "error": str(e)}
                self.wfile.write(json.dumps(response).encode())

        else:
            self.send_error(404)

print(f"yt-dlp Bridge serving at http://localhost:{PORT}")
with socketserver.TCPServer(("", PORT), BridgeHandler) as httpd:
    httpd.serve_forever()
