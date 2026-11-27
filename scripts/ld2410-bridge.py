#!/usr/bin/env python3
# Brücke zwischen Daemon und Radar (HLK-LD2410C) an der seriellen Schnittstelle: stdin → UART, UART → stdout.
# Python, weil Node keine Baudrate setzen kann und 256000 keine Standardrate ist (stty lehnt sie ab);
# termios2 mit BOTHER erlaubt beliebige Raten. Aufruf: ld2410-bridge.py /dev/serial0 [baud]
import fcntl, os, struct, sys, threading

TCGETS2, TCSETS2 = 0x802C542A, 0x402C542B  # _IOR/_IOW('T', 0x2A/0x2B, struct termios2), 44 Bytes
CBAUD, BOTHER, CSIZE, CS8, CSTOPB, CREAD, PARENB, CLOCAL, CRTSCTS = (
    0o010017, 0o010000, 0o60, 0o60, 0o100, 0o200, 0o400, 0o4000, 0o20000000000)
VTIME, VMIN = 5, 6

dev = sys.argv[1]
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 256000
fd = os.open(dev, os.O_RDWR | os.O_NOCTTY)

# struct termios2: iflag, oflag, cflag, lflag (je 4), c_line (1), c_cc[19], ispeed, ospeed (je 4)
t = bytearray(44)
fcntl.ioctl(fd, TCGETS2, t)
cflag = struct.unpack_from("I", t, 8)[0]
cflag = (cflag & ~(CBAUD | CSIZE | CSTOPB | PARENB | CRTSCTS)) | BOTHER | CS8 | CREAD | CLOCAL
struct.pack_into("4I", t, 0, 0, 0, cflag, 0)  # roh: keine Zeilen-, Echo- oder Zeichenumsetzung
t[17 + VTIME], t[17 + VMIN] = 0, 1
struct.pack_into("2I", t, 36, baud, baud)
fcntl.ioctl(fd, TCSETS2, t)


def upstream():
    while True:
        data = os.read(0, 256)
        if not data:
            os._exit(0)  # Daemon weg: Brücke auch beenden
        os.write(fd, data)


threading.Thread(target=upstream, daemon=True).start()
out = sys.stdout.buffer
while True:
    data = os.read(fd, 256)
    if not data:
        sys.exit(1)
    out.write(data)
    out.flush()
