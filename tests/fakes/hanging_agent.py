#!/usr/bin/env python3
import sys
import time


for index in range(1, 13):
    print("STALL-TAIL-%02d" % index, flush=True)
sys.stdout.flush()
time.sleep(60)
