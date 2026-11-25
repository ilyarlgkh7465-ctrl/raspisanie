#!/usr/bin/env python3
"""Сервер расписания.

Отдаёт страницу из web/ и API отметок старосты:
  ДЗ (dz), самостоятельные (sr) и комментарии (note: «пары не будет», другая аудитория, заметка).

  GET    /api/tasks        — все отметки (видят все)
  GET    /api/me           — {"admin": true/false} по заголовку X-Admin-Key
  POST   /api/tasks        — добавить (только староста)
  PUT    /api/tasks/<id>   — изменить (только староста)
  DELETE /api/tasks/<id>   — удалить (только староста)

Код старосты: переменная RASP_ADMIN_KEY или файл <state>/admin_key.txt
(создаётся сам при первом запуске). Неверный код: 5 попыток с адреса за 15 минут,
50 попыток со всех адресов за час — дальше вход закрыт на 15 минут.

Без зависимостей, Python 3.8+. Запуск: python3 server.py [порт]   (по умолчанию 8797)
"""
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
WEB = Path(os.environ.get('RASP_WEB_DIR', str(ROOT / 'web')))
STATE = Path(os.environ.get('RASP_STATE_DIR', str(ROOT / 'state')))
TASKS_FILE = STATE / 'tasks.json'
KEY_FILE = STATE / 'admin_key.txt'
LOCK = threading.Lock()

KINDS = {'dz', 'sr', 'note'}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MAX_BODY = 16 * 1024
MAX_TASKS = 3000

# Защита кода от перебора
FAIL_LOCK = threading.Lock()
FAILS_IP = {}          # адрес -> [время неудачных попыток]
FAILS_ALL = []         # все неудачные попытки
IP_LIMIT, IP_WINDOW = 5, 15 * 60
ALL_LIMIT, ALL_WINDOW = 50, 60 * 60
BLOCK_FOR = 15 * 60


def admin_key():
    env = os.environ.get('RASP_ADMIN_KEY', '').strip()
    if env:
        return env
    STATE.mkdir(parents=True, exist_ok=True)
    if not KEY_FILE.exists():
        KEY_FILE.write_text(secrets.token_urlsafe(9), encoding='utf-8')
        os.chmod(KEY_FILE, 0o600)
    return KEY_FILE.read_text(encoding='utf-8').strip()


KEY = admin_key()


def load_tasks():
    try:
        return json.loads(TASKS_FILE.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {'updated': None, 'items': []}


def save_tasks(data):
    STATE.mkdir(parents=True, exist_ok=True)
    data['updated'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    tmp = TASKS_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, TASKS_FILE)


def clean(body):
    """Проверяет отметку целиком и возвращает только известные поля."""
    out = {}
    kind = str(body.get('kind', ''))
    if kind not in KINDS:
        raise ValueError('Тип — ДЗ, СР или комментарий')
    out['kind'] = kind

    d = str(body.get('date', ''))
    if not DATE_RE.match(d):
        raise ValueError('Неверная дата')
    out['date'] = d

    try:
        p = int(body.get('pair'))
    except (TypeError, ValueError):
        raise ValueError('Неверный номер пары')
    if not (0 if kind == 'note' else 1) <= p <= 8:
        raise ValueError('Неверный номер пары')
    out['pair'] = p

    s = str(body.get('s') or '').strip()
    if len(s) > 200 or (p > 0 and not s):
        raise ValueError('Нет предмета')
    out['s'] = s

    t = str(body.get('text') or '').strip()
    if len(t) > 1500:
        raise ValueError('Слишком длинный текст')
    out['text'] = t

    if kind == 'note':
        out['cancel'] = bool(body.get('cancel'))
        room = str(body.get('room') or '').strip()
        if len(room) > 40:
            raise ValueError('Слишком длинная аудитория')
        out['room'] = room
        if not (t or out['cancel'] or room):
            raise ValueError('Напиши комментарий')
    elif kind == 'dz' and not t:
        raise ValueError('Напиши, что задали')

    for f in ('split', 'opt'):
        v = body.get(f)
        out[f] = str(v)[:20] if v else None
    return out


def blocked(ip, now):
    with FAIL_LOCK:
        fails = [x for x in FAILS_IP.get(ip, []) if now - x < max(IP_WINDOW, BLOCK_FOR)]
        FAILS_IP[ip] = fails
        recent = [x for x in fails if now - x < IP_WINDOW]
        if len(recent) >= IP_LIMIT and now - recent[-1] < BLOCK_FOR:
            return True
        FAILS_ALL[:] = [x for x in FAILS_ALL if now - x < ALL_WINDOW]
        return len(FAILS_ALL) >= ALL_LIMIT and now - FAILS_ALL[-1] < BLOCK_FOR


def note_fail(ip, now):
    with FAIL_LOCK:
        FAILS_IP.setdefault(ip, []).append(now)
        FAILS_ALL.append(now)
        if len(FAILS_IP) > 5000:  # не даём словарю расти бесконечно
            for k in list(FAILS_IP)[:1000]:
                FAILS_IP.pop(k, None)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{
        '.webmanifest': 'application/manifest+json',
        '.js': 'text/javascript',
        '.json': 'application/json',
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    # --- общее ---
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (time.strftime('%H:%M:%S'), fmt % args))

    def client_ip(self):
        ip = self.client_address[0]
        fwd = self.headers.get('X-Forwarded-For', '')
        if ip in ('127.0.0.1', '::1') and fwd:  # за Caddy
            return fwd.split(',')[0].strip()
        return ip

    def auth(self):
        """'ok' — староста, 'no' — без кода или неверный код, 'blocked' — слишком много попыток."""
        k = self.headers.get('X-Admin-Key', '')
        if not k:
            return 'no'
        ip, now = self.client_ip(), time.time()
        if blocked(ip, now):
            return 'blocked'
        if hmac.compare_digest(k.encode(), KEY.encode()):
            return 'ok'
        note_fail(ip, now)
        return 'no'

    def send_json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            raise ValueError('Слишком большой запрос')
        try:
            data = json.loads(self.rfile.read(n) or b'{}')
        except json.JSONDecodeError:
            raise ValueError('Неверный JSON')
        if not isinstance(data, dict):
            raise ValueError('Неверный запрос')
        return data

    def route(self):
        path = urlparse(self.path).path
        m = re.match(r'^/api/tasks/([\w-]{1,40})$', path)
        return path, (m.group(1) if m else None)

    # --- методы ---
    def do_GET(self):
        path, _ = self.route()
        if path == '/api/tasks':
            with LOCK:
                return self.send_json(200, load_tasks())
        if path == '/api/me':
            a = self.auth()
            if a == 'blocked':
                return self.send_json(429, {'admin': False, 'error': 'Слишком много попыток, подожди 15 минут'})
            return self.send_json(200, {'admin': a == 'ok'})
        if path.startswith('/api/'):
            return self.send_json(404, {'error': 'Нет такого адреса'})
        return super().do_GET()

    def guarded(fn):
        def wrap(self):
            if not self.route()[0].startswith('/api/'):
                return self.send_json(405, {'error': 'Нельзя'})
            a = self.auth()
            if a == 'blocked':
                return self.send_json(429, {'error': 'Слишком много попыток, подожди 15 минут'})
            if a != 'ok':
                return self.send_json(403, {'error': 'Только для старосты'})
            try:
                return fn(self)
            except ValueError as e:
                return self.send_json(400, {'error': str(e)})
        return wrap

    @guarded
    def do_POST(self):
        path, _ = self.route()
        if path != '/api/tasks':
            return self.send_json(404, {'error': 'Нет такого адреса'})
        item = clean(self.read_json())
        item['id'] = uuid.uuid4().hex[:12]
        item['created'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        with LOCK:
            data = load_tasks()
            if len(data['items']) >= MAX_TASKS:
                return self.send_json(400, {'error': 'Слишком много отметок'})
            data['items'].append(item)
            save_tasks(data)
        return self.send_json(201, item)

    @guarded
    def do_PUT(self):
        _, tid = self.route()
        if not tid:
            return self.send_json(404, {'error': 'Нет такого адреса'})
        patch = self.read_json()
        with LOCK:
            data = load_tasks()
            for i, it in enumerate(data['items']):
                if it.get('id') == tid:
                    merged = dict(it)
                    merged.update(patch)
                    new = clean(merged)
                    new.update(id=tid, created=it.get('created'), edited=time.strftime('%Y-%m-%dT%H:%M:%S'))
                    data['items'][i] = new
                    save_tasks(data)
                    return self.send_json(200, new)
        return self.send_json(404, {'error': 'Не найдено'})

    @guarded
    def do_DELETE(self):
        _, tid = self.route()
        if not tid:
            return self.send_json(404, {'error': 'Нет такого адреса'})
        with LOCK:
            data = load_tasks()
            before = len(data['items'])
            data['items'] = [it for it in data['items'] if it.get('id') != tid]
            if len(data['items']) == before:
                return self.send_json(404, {'error': 'Не найдено'})
            save_tasks(data)
        return self.send_json(200, {'ok': True})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8797))
    host = os.environ.get('HOST', '127.0.0.1')
    srv = ThreadingHTTPServer((host, port), Handler)
    where = 'RASP_ADMIN_KEY' if os.environ.get('RASP_ADMIN_KEY') else str(KEY_FILE)
    print(f'Расписание: http://{host}:{port}  (код старосты — в {where})', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
