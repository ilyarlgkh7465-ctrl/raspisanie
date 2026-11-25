#!/bin/bash
# Выкладка расписания: код в /opt/rasp (прежний — в /var/backups/rasp), перезапуск службы, проверка.
# Нужен CFG — путь к ssh-конфигу, где описан хост mila (вход на сервер по ключу)
# Откат: ssh mila 'ls /var/backups/rasp' → rm -rf /opt/rasp && tar -C /opt -xzf <копия> && systemctl restart rasp
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CFG:?нужен CFG — путь к ssh-конфигу с хостом mila}"
node --check web/app.js
python3 -m py_compile server.py
COPYFILE_DISABLE=1 tar --no-xattrs --exclude '__pycache__' -cf - server.py web | ssh -F "$CFG" mila 'set -e
  TS=$(date +%Y%m%d-%H%M%S); mkdir -p /var/backups/rasp
  if [ -d /opt/rasp ]; then tar -C /opt -czf /var/backups/rasp/code-$TS.tgz rasp; fi
  ls -1t /var/backups/rasp/code-*.tgz 2>/dev/null | tail -n +21 | xargs -r rm -f
  rm -rf /opt/rasp.new && mkdir -p /opt/rasp.new && tar -C /opt/rasp.new --no-same-owner -xf -
  chown -R root:root /opt/rasp.new && chmod -R u+rwX,go+rX,go-w /opt/rasp.new
  rm -rf /opt/rasp.old; if [ -d /opt/rasp ]; then mv /opt/rasp /opt/rasp.old; fi; mv /opt/rasp.new /opt/rasp
  systemctl restart rasp; sleep 1.5
  echo "служба: $(systemctl is-active rasp)"
  echo "изнутри: $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8793/) $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8793/api/tasks)"
  echo "копия прежней версии: ${TS}"'
curl -s --interface en0 --resolve rasp.130-49-141-77.sslip.io:443:130.49.141.77 -o /dev/null \
  -w "снаружи: %{http_code}\n" https://rasp.130-49-141-77.sslip.io/ || echo "снаружи: нет ответа"
