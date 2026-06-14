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

            if not video_id:
                self.send_error(400, "Missing videoId")
                return

            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()

            # Run yt-dlp
            # yt-dlp --download-sections "*8:13-8:45" "https://www.youtube.com/watch?v=BScdjYYW8-g"
            url = f"https://www.youtube.com/watch?v={video_id}"
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
                try:
                    subprocess.run(cmd, check=True)
                    # Find the produced file
                    files = os.listdir(tmpdir)
                    if not files:
                        raise Exception("yt-dlp produced no files")
                    
                    produced_file = os.path.join(tmpdir, files[0])
                    # Move to downloads folder (simple assumption for now, or just let the user know)
                    downloads_path = os.path.expanduser("~/Downloads")
                    final_path = os.path.join(downloads_path, filename)
                    shutil.move(produced_file, final_path)
                    
                    response = {"success": True, "path": final_path}
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
