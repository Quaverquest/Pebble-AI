"""
Pebble AI Windows 11 Host Mouse & Keyboard Control Worker
Runs on 127.0.0.1:7863 and executes real Win32 User32 input events strictly for
censored Pebble AI models authorized by the host security policy.
"""

import ctypes
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

IS_WINDOWS = sys.platform.startswith("win")

if IS_WINDOWS:
    user32 = ctypes.windll.user32

    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_MIDDLEDOWN = 0x0020
    MOUSEEVENTF_MIDDLEUP = 0x0040
    MOUSEEVENTF_WHEEL = 0x0800

    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004

    INPUT_KEYBOARD = 1

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", ctypes.c_ushort),
            ("wScan", ctypes.c_ushort),
            ("dwFlags", ctypes.c_ulong),
            ("time", ctypes.c_ulong),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT_UNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("padding", ctypes.c_ubyte * 32)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", ctypes.c_ulong), ("union", INPUT_UNION)]

    VK_MAP = {
        "ctrl": 0x11,
        "control": 0x11,
        "alt": 0x12,
        "shift": 0x10,
        "win": 0x5B,
        "windows": 0x5B,
        "enter": 0x0D,
        "return": 0x0D,
        "tab": 0x09,
        "esc": 0x1B,
        "escape": 0x1B,
        "space": 0x20,
        "backspace": 0x08,
        "delete": 0x2E,
        "up": 0x26,
        "down": 0x28,
        "left": 0x25,
        "right": 0x27,
        "f4": 0x73,
        "f5": 0x74,
        "f11": 0x7A,
    }


def _resolve_vk(key: str) -> int:
    k = key.strip().lower()
    if k in VK_MAP:
        return VK_MAP[k]
    if len(k) == 1:
        vk = user32.VkKeyScanW(ord(k)) & 0xFF
        return vk
    return 0


def _send_unicode_char(ch: str):
    down = INPUT(type=INPUT_KEYBOARD)
    down.union.ki = KEYBDINPUT(wVk=0, wScan=ord(ch), dwFlags=KEYEVENTF_UNICODE, time=0, dwExtraInfo=None)
    up = INPUT(type=INPUT_KEYBOARD)
    up.union.ki = KEYBDINPUT(
        wVk=0, wScan=ord(ch), dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time=0, dwExtraInfo=None
    )
    arr = (INPUT * 2)(down, up)
    user32.SendInput(2, ctypes.byref(arr), ctypes.sizeof(INPUT))


def execute_action(payload: dict) -> dict:
    if not IS_WINDOWS:
        raise RuntimeError("Win32 User32 mouse/keyboard worker requires Windows 11 host.")

    action = payload.get("action")
    if action == "mouse_move":
        x = int(payload.get("x", 0))
        y = int(payload.get("y", 0))
        user32.SetCursorPos(x, y)
        return {"ok": True, "detail": f"Cursor moved to ({x}, {y})"}

    if action == "mouse_click":
        if payload.get("x") is not None and payload.get("y") is not None:
            user32.SetCursorPos(int(payload["x"]), int(payload["y"]))
            time.sleep(0.03)
        btn = payload.get("button", "left")
        down_flag, up_flag = (
            (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
            if btn == "right"
            else (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP)
            if btn == "middle"
            else (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
        )
        clicks = 2 if payload.get("doubleClick") else 1
        for _ in range(clicks):
            user32.mouse_event(down_flag, 0, 0, 0, 0)
            user32.mouse_event(up_flag, 0, 0, 0, 0)
            time.sleep(0.05)
        return {"ok": True, "detail": f"Dispatched {btn} click x{clicks}"}

    if action == "mouse_scroll":
        delta = int(payload.get("deltaY", -120))
        user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        return {"ok": True, "detail": f"Scrolled mouse wheel by {delta}"}

    if action == "keyboard_type":
        text = str(payload.get("text", ""))
        for ch in text:
            _send_unicode_char(ch)
            time.sleep(0.008)
        return {"ok": True, "detail": f"Typed {len(text)} characters"}

    if action == "keyboard_hotkey":
        keys = payload.get("keys") or []
        vks = [vk for vk in (_resolve_vk(str(k)) for k in keys) if vk > 0]
        for vk in vks:
            user32.keybd_event(vk, 0, 0, 0)
        time.sleep(0.03)
        for vk in reversed(vks):
            user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
        return {"ok": True, "detail": f"Pressed hotkey {'+'.join(keys)}"}

    raise ValueError(f"Unsupported action: {action}")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict):
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/status":
            w = user32.GetSystemMetrics(0) if IS_WINDOWS else 0
            h = user32.GetSystemMetrics(1) if IS_WINDOWS else 0
            self._send(200, {"ok": True, "platform": sys.platform, "screenWidth": w, "screenHeight": h})
            return
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
            result = execute_action(payload)
            self._send(200, result)
        except Exception as exc:
            self._send(500, {"ok": False, "error": str(exc)})


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 7863), Handler)
    print("Pebble PC Control Worker listening on http://127.0.0.1:7863")
    server.serve_forever()
