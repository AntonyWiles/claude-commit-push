# Windows launcher: runs the collector under pythonw (no console window),
# sending its log to ~/.claude/usage-meter/local/collector.log.
import os, runpy, sys
here = os.path.dirname(os.path.abspath(__file__))
log = os.path.join(os.path.expanduser("~"), ".claude", "usage-meter", "local", "collector.log")
os.makedirs(os.path.dirname(log), exist_ok=True)
sys.stdout = sys.stderr = open(log, "a", encoding="utf-8", buffering=1)
script = os.path.join(here, "..", "collector", "umeter.py")
sys.path.insert(0, os.path.dirname(script))
sys.argv = [script, "run"]
runpy.run_path(script, run_name="__main__")
