#!/bin/zsh

current_script_dir=$(cd "$(dirname "${(%):-%N}")" && pwd)
gpt_script=$current_script_dir/gpt.ts
history_script=$current_script_dir/gpt-db.ts

gpt_request() {

    result=$(cd $HOME && $gpt_script "$BUFFER")
    result_length=${#result}

    BUFFER="$result"
    CURSOR=$result_length
    zle redisplay
}

choose_from_request_history() {
    local selected=$($history_script \
        | fzf --height 50% --reverse --border \
        --header='GPT History (↑/↓: navigate, Enter: select, Tab: prompt/response, Ctrl-D: date, Ctrl-T: time, Ctrl-S: sort)' \
        --preview 'echo -e "\033[1;34mID:\033[0m $(echo {} | grep -o "\[[0-9]*\]" | head -1 | tr -d "[]")\n\033[1;33mDate:\033[0m $(echo {} | grep -o "\[[^]]*\]" | tail -1 | tr -d "[]")\n\n\033[1;34mPrompt:\033[0m\n$(echo {} | cut -d "|" -f 2 | sed "s/^ //g")\n\n\033[1;32mResponse:\033[0m\n$(echo {} | cut -d "|" -f 3 | sed "s/^ //g")"' \
        --preview-window=up:wrap:60%:border \
        --bind 'tab:transform:[[ ! {q} =~ ^prompt: ]] && echo "prompt: {}" || echo {q} | sed "s/^prompt: //g"' \
        --bind 'ctrl-d:transform:[[ ! {q} =~ ^date: ]] && echo "date: {}" || echo {q} | sed "s/^date: //g"' \
        --bind 'ctrl-t:transform:[[ ! {q} =~ ^time: ]] && echo "time: {}" || echo {q} | sed "s/^time: //g"' \
        --bind 'ctrl-s:transform:[[ ! {q} =~ ^sort: ]] && echo "sort: {}" || echo {q} | sed "s/^sort: //g"')

    if [[ -n $selected ]]; then
        if [[ "$QUERY" == prompt:* ]]; then
            split=$(echo "$selected" | cut -d '|' -f 2 | sed "s/^ //g")
        else
            split=$(echo "$selected" | cut -d '|' -f 3 | sed "s/^ //g")
        fi
        BUFFER="$split"
        CURSOR=${#BUFFER}
        zle redisplay
    fi
}

# define the widgets
zle -N gpt_request
zle -N choose_from_request_history

# bind the widgets to keys
bindkey '^g' gpt_request
bindkey '^h' choose_from_request_history