#!/bin/zsh

current_script_dir=$(cd "$(dirname "${(%):-%N}")" && pwd)
gpt_script=$current_script_dir/gpt.ts

gpt_request() {

    result=$(cd $HOME && $gpt_script "$BUFFER")
    result_length=${#result}

    BUFFER="$result"
    CURSOR=$result_length
    zle redisplay
}

zle -N gpt_request
bindkey '^g' gpt_request