#!/bin/bash
# record-demo.sh — drive the live tktop TUI through a feature tour in tmux and
# capture ANSI frames; scripts/ansi2gif.py then renders docs/demo.gif.
# Perfectly deterministic: this script never interacted with is the target TUI.
set -u
W=110; H=33
FRAMES=/place/vartmp/opencode/demo-frames
rm -rf "$FRAMES" && mkdir -p "$FRAMES"

N=0
snap() { # snap <hold-cs>
  N=$((N+1))
  tmux capture-pane -t demo -e -p > "$FRAMES/frame-$(printf %03d "$N").txt"
  echo "$N $1" >> "$FRAMES/durations.txt"
}

type_() { for ((i=0;i<${#1};i++)); do tmux send-keys -t demo "${1:i:1}"; sleep 0.05; done; }

export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

tmux kill-server 2>/dev/null; sleep 1
tmux new-session -d -s demo -x $W -y $H "bun run src/index.ts --all --sort tokens"

sleep 5                       # let rows + dots settle
snap 1600
snap 200                      # second live frame (dots/trails move → visible liveness)
tmux send-keys -t demo "g"; sleep 0.6   # group-by harness: subtotal rows
snap 1100
tmux send-keys -t demo "g"; tmux send-keys -t demo "g"; sleep 0.4 # harness → model → none
tmux send-keys -t demo "t";  sleep 0.8   # tree view
snap 1100
tmux send-keys -t demo "t"           # back to flat
snap 300
tmux send-keys -t demo "/"; sleep 0.4  # live filter typing
type_ "RAN";  snap 700
type_ "GER";  snap 700
tmux send-keys -t demo Enter; sleep 0.8 # confirm filter
snap 1100
tmux send-keys -t demo Enter; sleep 1.2 # drill-down overlay
snap 1500
tmux send-keys -t demo j; sleep 0.4; tmux send-keys -t demo j; sleep 0.6  # scroll timeline
snap 900
tmux send-keys -t demo Escape; sleep 0.5
snap 500
tmux send-keys -t demo q; sleep 1

echo "recorded $N frames"
