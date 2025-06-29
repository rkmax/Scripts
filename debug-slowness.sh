# !/bin/bash
vmstat 1
cat /proc/pressure/memory
sudo perf sched record 5s && sudo perf sched latency | head
