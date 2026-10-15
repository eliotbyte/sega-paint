"""Dev server for the player with caching disabled, so engine/worklet changes always reach the browser.
It also takes the art editor's saves (POST /api/art): the pictures (player/art/<kind>/<name>.png), the list of them
(art.json), the track colours (palette.json) and the interface colours (theme.json). Every file it replaces or
deletes is copied to player/art/backup/<date-time>/ first.
It also lists and writes the Description panel's pictures (player/songs/_games/<game>/<name>.png, GET and POST
/api/game-pictures); the image each was made from and its crop are kept in art-src/_pictures/<game>/, to redo it.
And it writes a song's Description pages (POST /api/song-info: "info" in player/songs/<dir>/meta.json, nothing else).
usage: python tools/serve.py [port]"""
import base64, functools, http.server, json, os, re, shutil, socket, sys, threading, time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'player')
ART = os.path.join(ROOT, 'art')
KINDS = ('tools', 'small', 'notes', 'cursors', 'clefs', 'pictures')
PICTURE = re.compile(r'^(%s)/[A-Za-z0-9_]+(-[0-9]{1,3})?\.png$' % '|'.join(KINDS))
JSONS = ('art.json', 'palette.json', 'theme.json')
GAMES = os.path.join(ROOT, 'songs', '_games')
SOURCES = os.path.join(ROOT, '..', 'art-src', '_pictures')
SLUG = re.compile(r'^[a-z0-9][a-z0-9-]{0,40}$')


def png_of(url):
    png = base64.b64decode(url.split(',', 1)[1])
    if not png.startswith(b'\x89PNG'):
        raise ValueError('not a PNG')
    return png


def keep(path, stamp):
    """Copies a file about to change into player/art/backup/<stamp>/ (same path below the project)."""
    if os.path.exists(path):
        rel = os.path.relpath(path, os.path.join(ROOT, '..'))
        dst = os.path.join(ART, 'backup', stamp, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(path, dst)


def list_pictures():
    games = {}
    for game in sorted(os.listdir(GAMES)) if os.path.isdir(GAMES) else []:
        d = os.path.join(GAMES, game)
        if os.path.isdir(d) and SLUG.match(game):
            games[game] = [{'name': f[:-4], 'source': os.path.exists(os.path.join(SOURCES, game, f[:-4] + '.json'))}
                           for f in sorted(os.listdir(d)) if f.endswith('.png')]
    return {'ok': True, 'games': games}


def song_info_post(body):
    d, info = body.get('dir', ''), body.get('info')
    path = os.path.join(ROOT, 'songs', d, 'meta.json')
    if not SLUG.match(d) or not os.path.exists(path):
        raise ValueError('no such song: ' + d)
    pages = info.get('pages') if isinstance(info, dict) else None
    if not isinstance(pages, list):
        raise ValueError('info.pages must be a list')
    for p in pages:
        if not isinstance(p, dict) or not set(p) <= {'picture', 'caption', 'title', 'text'}:
            raise ValueError('a page is {picture, caption} or {title, text}')
        if 'picture' in p and not re.match(r'^\.\./_games/[a-z0-9-]+/[a-z0-9-]+\.png$', p['picture']):
            raise ValueError('bad picture: ' + str(p['picture']))
    meta = json.load(open(path, encoding='utf-8'))
    stamp = time.strftime('%Y%m%d-%H%M%S')
    keep(path, stamp)
    if pages:
        meta['info'] = {**info, 'pages': pages}
    else:
        meta.pop('info', None)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return {'ok': True, 'backup': stamp}


def picture_post(body):
    game, name = body.get('game', ''), body.get('name', '')
    if not SLUG.match(game) or not SLUG.match(name):
        raise ValueError('names: small letters, digits and -')
    out, src = os.path.join(GAMES, game, name + '.png'), os.path.join(SOURCES, game, name)
    if body.get('get'):  # the image a picture was made from, and how
        if not os.path.exists(src + '.json'):
            return {'ok': True, 'source': None}
        info = json.load(open(src + '.json', encoding='utf-8'))
        with open(src + '.png', 'rb') as f:
            info['image'] = 'data:image/png;base64,' + base64.b64encode(f.read()).decode()
        return {'ok': True, 'source': info}
    stamp = time.strftime('%Y%m%d-%H%M%S')
    if body.get('delete'):
        for path in (out, src + '.png', src + '.json'):
            keep(path, stamp)
            if os.path.exists(path):
                os.remove(path)
        return {'ok': True, 'backup': stamp}
    if os.path.exists(out) and not body.get('replace'):
        raise ValueError('there is a picture with this name already')
    png = png_of(body['png'])
    keep(out, stamp)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(png)
    if body.get('source'):
        os.makedirs(os.path.dirname(src), exist_ok=True)
        for path in (src + '.png', src + '.json'):
            keep(path, stamp)
        with open(src + '.png', 'wb') as f:
            f.write(png_of(body['source']))
        with open(src + '.json', 'w', encoding='utf-8') as f:
            json.dump(body.get('settings', {}), f, indent=1)
    return {'ok': True, 'backup': stamp}


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def reply(self, reply, code=200):
        data = json.dumps(reply).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/game-pictures':
            self.reply(list_pictures())
        else:
            super().do_GET()

    def do_POST(self):
        if self.path in ('/api/game-pictures', '/api/song-info'):
            try:
                size = int(self.headers.get('Content-Length', 0))
                if size > 64 << 20:
                    raise ValueError('too big')
                body = json.loads(self.rfile.read(size))
                self.reply(picture_post(body) if self.path == '/api/game-pictures' else song_info_post(body))
            except Exception as e:  # noqa: BLE001 - report anything to the editor
                self.reply({'ok': False, 'error': str(e)}, 400)
            return
        if self.path != '/api/art':
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', 0))
            if size > 32 << 20:
                raise ValueError('too big')
            body = json.loads(self.rfile.read(size))
            try:
                current = json.load(open(os.path.join(ART, 'art.json'), encoding='utf-8')).get('version', 0)
            except (OSError, ValueError):
                current = 0
            if 'base' in body and body['base'] != current:
                raise ValueError('the art changed since this page was opened (another tab saved it): reload the page; '
                                 'your unsaved changes here would overwrite it')
            files = body.get('files', {})
            delete = body.get('delete', [])
            for rel in [*files, *delete]:
                if not PICTURE.match(rel):
                    raise ValueError('bad file name: ' + rel)
            pngs = {}
            for rel, url in files.items():
                png = base64.b64decode(url.split(',', 1)[1])
                if not png.startswith(b'\x89PNG'):
                    raise ValueError('not a PNG: ' + rel)
                pngs[rel] = png
            stamp = time.strftime('%Y%m%d-%H%M%S')
            backup = os.path.join(ART, 'backup', stamp)

            def keep(rel):  # copy the current file to the backup before it changes
                src = os.path.join(ART, rel)
                if os.path.exists(src):
                    os.makedirs(os.path.dirname(os.path.join(backup, rel)), exist_ok=True)
                    shutil.copyfile(src, os.path.join(backup, rel))

            for rel, png in pngs.items():
                keep(rel)
                os.makedirs(os.path.dirname(os.path.join(ART, rel)), exist_ok=True)
                with open(os.path.join(ART, rel), 'wb') as f:
                    f.write(png)
            for rel in delete:
                keep(rel)
                if os.path.exists(os.path.join(ART, rel)):
                    os.remove(os.path.join(ART, rel))
            for name, key in zip(JSONS, ('manifest', 'palette', 'theme')):
                if key in body:
                    keep(name)
                    with open(os.path.join(ART, name), 'w', encoding='utf-8') as f:
                        json.dump(body[key], f, indent=1)
            reply, code = {'ok': True, 'backup': stamp, 'written': len(pngs), 'deleted': len(delete)}, 200
        except Exception as e:  # noqa: BLE001 - report anything to the editor
            reply, code = {'ok': False, 'error': str(e)}, 400
        self.reply(reply, code)


class Server6(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCache, directory=ROOT)
    print(f'Sega Paint: http://localhost:{port}  ·  art editor: http://localhost:{port}/art.html')
    # 'localhost' tries IPv6 first: answer there too (loopback only), or every request waits for the fallback
    try:
        threading.Thread(target=Server6(('::1', port), handler).serve_forever, daemon=True).start()
    except OSError:
        pass
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
