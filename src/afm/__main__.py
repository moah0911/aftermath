"""python -m afm — mirrors `afm <command>`; argument handling lives in afm.cli."""

import sys

from afm.cli import run

if __name__ == "__main__":
    run()  # run() resolves argv and exits (never returns)
    sys.exit(0)  # unreachable; placates linters
