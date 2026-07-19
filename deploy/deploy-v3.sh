#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/zhanghao19900118-boop/hao18.git}"
BRANCH="${BRANCH:-feature/v3-auth-comments}"
APP_DIR="/opt/worldcup"
DB_DIR="/var/lib/worldcup"

[[ $EUID -eq 0 ]] || { echo "请使用 root 运行"; exit 1; }
command -v apt-get >/dev/null || { echo "仅支持 Ubuntu/Debian"; exit 1; }

apt-get update
apt-get install -y nginx git curl ca-certificates sqlite3
if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id worldcup >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin worldcup
install -d -m 755 -o worldcup -g worldcup "$APP_DIR"
install -d -m 750 -o worldcup -g worldcup "$DB_DIR" /var/backups/worldcup

if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u worldcup git -C "$APP_DIR" fetch origin "$BRANCH"
  sudo -u worldcup git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u worldcup git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  if [[ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    backup="${APP_DIR}.backup.$(date +%Y%m%d%H%M%S)"
    mv "$APP_DIR" "$backup"
    install -d -m 755 -o worldcup -g worldcup "$APP_DIR"
    echo "原目录已备份到 $backup"
  fi
  sudo -u worldcup git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
sudo -u worldcup npm ci --omit=dev
cat >/etc/worldcup.env <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DB_PATH=/var/lib/worldcup/worldcup.db
COOKIE_SECURE=true
TRUST_PROXY=1
SESSION_DAYS=7
ENV
chmod 640 /etc/worldcup.env
chown root:worldcup /etc/worldcup.env

sudo -u worldcup env DB_PATH="$DB_DIR/worldcup.db" npm run migrate
if [[ "$(sudo -u worldcup sqlite3 "$DB_DIR/worldcup.db" 'SELECT COUNT(*) FROM matches;')" = "0" ]]; then
  read -rp "首个管理员用户名：" admin_user
  read -rp "管理员显示名：" admin_name
  read -rsp "管理员初始密码（至少10位，含字母数字）：" admin_password; echo
  sudo -u worldcup env DB_PATH="$DB_DIR/worldcup.db" ADMIN_USERNAME="$admin_user" ADMIN_DISPLAY_NAME="$admin_name" ADMIN_INITIAL_PASSWORD="$admin_password" npm run seed
fi

install -m 644 deploy/worldcup.service /etc/systemd/system/worldcup.service
install -m 755 deploy/backup-worldcup /usr/local/bin/backup-worldcup
install -m 755 deploy/update-worldcup-v3 /usr/local/bin/update-worldcup-v3
systemctl daemon-reload
systemctl enable --now worldcup

cat >/etc/cron.d/worldcup-backup <<'CRON'
25 3 * * * root /usr/local/bin/backup-worldcup >>/var/log/worldcup-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/worldcup-backup

curl -fsS http://127.0.0.1:3000/api/health
echo
echo "V3 后端已部署。下一步：配置域名、Certbot 和 deploy/nginx-worldcup-v3.conf。"
