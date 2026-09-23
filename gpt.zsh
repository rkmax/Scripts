#!/bin/zsh

current_script_dir=$(cd "$(dirname "${(%):-%N}")" && pwd)
gpt_script=$current_script_dir/gpt.ts
history_script=$current_script_dir/gpt-db.ts

typeset -g GPT_REQUEST_IN_FLIGHT=0
typeset -g GPT_REQUEST_FD=-1
typeset -g GPT_REQUEST_RAW=""
typeset -g GPT_REQUEST_ORIGINAL_BUFFER=""
typeset -g GPT_REQUEST_ORIGINAL_CURSOR=0
typeset -g GPT_REQUEST_LAST_SUGGESTION=""
typeset -g GPT_REQUEST_STATUS_TOKEN="__GPT_STATUS_3692FC77A30A4B66__"

gpt_provider_label() {
    local provider="${COMMAND_ASSISTANT_PROVIDER:-${GPT_PROVIDER:-openai}}"
    provider="${${provider:l}//[[:space:]]/}"

    case "$provider" in
        auto)
            if [[ -n "${COMMAND_ASSISTANT_OPENAI_API_KEY:-${OPENAI_API_KEY:-${CODEX_API_KEY:-}}}" ]]; then
                echo "OpenAI"
            else
                echo "Ollama"
            fi
            ;;
        ollama)
            echo "Ollama"
            ;;
        openai|"")
            echo "OpenAI"
            ;;
        *)
            echo "$provider"
            ;;
    esac
}

gpt_reset_async_state() {
    GPT_REQUEST_IN_FLIGHT=0
    GPT_REQUEST_RAW=""
    GPT_REQUEST_ORIGINAL_BUFFER=""
    GPT_REQUEST_ORIGINAL_CURSOR=0

    if (( GPT_REQUEST_FD >= 0 )); then
        zle -F "$GPT_REQUEST_FD" 2>/dev/null || true
        exec {GPT_REQUEST_FD}<&- 2>/dev/null || true
        GPT_REQUEST_FD=-1
    fi
}

gpt_finish_error() {
    local message="$1"
    zle -M "$message"
    zle redisplay
    gpt_reset_async_state
}

gpt_finish_success() {
    local corrected="$1"
    GPT_REQUEST_LAST_SUGGESTION="$corrected"
    zle gpt_apply_last_suggestion
    zle redisplay
    gpt_reset_async_state
}

gpt_on_request_ready() {
    emulate -L zsh
    local fd="$1"
    local line

    if IFS= read -r -u "$fd" line; then
        GPT_REQUEST_RAW+="$line"$'\n'
        return 0
    fi

    zle -F "$fd" 2>/dev/null || true
    exec {fd}<&- 2>/dev/null || true
    GPT_REQUEST_FD=-1

    local payload="${GPT_REQUEST_RAW%$'\n'}"
    local token_prefix="${GPT_REQUEST_STATUS_TOKEN}:"
    local status_line
    local response
    local exit_code

    if [[ "$payload" == *$'\n'"$token_prefix"* ]]; then
        status_line="${payload##*$'\n'}"
        response="${payload%$'\n'"$status_line"}"
    elif [[ "$payload" == "$token_prefix"* ]]; then
        status_line="$payload"
        response=""
    else
        gpt_finish_error "Assistant response could not be parsed."
        return 1
    fi

    exit_code="${status_line#"$token_prefix"}"
    if [[ "$exit_code" != <-> ]]; then
        gpt_finish_error "Assistant returned an invalid status."
        return 1
    fi

    if (( exit_code != 0 )); then
        local first_line="${response%%$'\n'*}"
        [[ -z "$first_line" ]] && first_line="Unable to correct command."
        gpt_finish_error "$first_line"
        return "$exit_code"
    fi

    if [[ -z "${response//[[:space:]]/}" ]]; then
        gpt_finish_error "Assistant returned an empty correction."
        return 1
    fi

    gpt_finish_success "$response"
}

gpt_start_async_request() {
    local prompt="$1"
    local token="$GPT_REQUEST_STATUS_TOKEN"

    exec {GPT_REQUEST_FD}< <(
        export DENO_NO_UPDATE_CHECK=1
        local response exit_code errfile
        errfile="$(mktemp)"
        response="$(cd "$HOME" && "$gpt_script" "$prompt" 2>"$errfile")"
        exit_code=$?
        (( exit_code != 0 )) && response="$(<"$errfile")"
        rm -f "$errfile"
        unset DENO_NO_UPDATE_CHECK
        printf '%s\n' "$response"
        printf '%s:%d\n' "$token" "$exit_code"
    ) || return 1

    zle -F "$GPT_REQUEST_FD" gpt_on_request_ready
    return 0
}

gpt_request() {
    local prompt="$BUFFER"
    local provider_label

    if (( GPT_REQUEST_IN_FLIGHT == 1 )); then
        zle -M "A correction request is already running."
        zle redisplay
        return 0
    fi

    if [[ -z "${prompt//[[:space:]]/}" ]]; then
        zle -M "Type a command before requesting a correction."
        zle redisplay
        return 0
    fi

    GPT_REQUEST_IN_FLIGHT=1
    GPT_REQUEST_ORIGINAL_BUFFER="$BUFFER"
    GPT_REQUEST_ORIGINAL_CURSOR=$CURSOR
    GPT_REQUEST_RAW=""

    if ! gpt_start_async_request "$prompt"; then
        gpt_finish_error "Failed to start command correction."
        return 1
    fi

    provider_label="$(gpt_provider_label)"
    zle -M "Correcting command with ${provider_label}..."
    zle redisplay
}

gpt_apply_last_suggestion() {
    if [[ -z "${GPT_REQUEST_LAST_SUGGESTION//[[:space:]]/}" ]]; then
        zle -M "No saved correction to apply."
        zle redisplay
        return 0
    fi

    BUFFER="$GPT_REQUEST_LAST_SUGGESTION"
    CURSOR=${#BUFFER}
    zle -M "Saved correction applied."
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
zle -N gpt_apply_last_suggestion
zle -N choose_from_request_history

# bind the widgets to keys
bindkey '^g' gpt_request
bindkey '^h' choose_from_request_history
bindkey '^X^G' gpt_apply_last_suggestion
