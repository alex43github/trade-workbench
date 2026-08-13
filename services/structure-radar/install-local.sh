#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h:h}
template_path="$script_dir/launchd/com.streetlight.structure-radar.plist.template"
user_home=${HOME:?HOME is required}
launch_agents_dir="$user_home/Library/LaunchAgents"
target_path="$launch_agents_dir/com.streetlight.structure-radar.plist"
node_bin=$(command -v node)
current_path=${PATH:-/usr/local/bin:/usr/bin:/bin}

if [[ ! -f "$template_path" ]]; then
  echo "缺少 LaunchAgent 模板: $template_path" >&2
  exit 1
fi

mkdir -p "$project_dir/.data/structure-radar" "$launch_agents_dir"
sed \
  -e "s#__PROJECT_DIR__#$project_dir#g" \
  -e "s#__NODE_BIN__#$node_bin#g" \
  -e "s#__PATH__#$current_path#g" \
  "$template_path" > "$target_path"

plutil -lint "$target_path"
echo "已生成 $target_path"
echo "默认 RADAR_NOTIFY_ENABLED=false；请先观察，再自行显式开启 Bark。"
echo "启动: launchctl bootstrap gui/$(id -u) $target_path"
echo "停止: launchctl bootout gui/$(id -u)/com.streetlight.structure-radar"
