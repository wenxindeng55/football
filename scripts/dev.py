from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = PROJECT_ROOT / "frontend"


def module_exists(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def validate_environment(include_collector: bool) -> bool:
    ok = True
    required_modules = ["fastapi", "uvicorn"]
    if include_collector:
        required_modules.extend(["requests", "bs4"])

    missing_modules = [name for name in required_modules if not module_exists(name)]
    if missing_modules:
        print("[dev] 缺少 Python API 依赖：" + ", ".join(missing_modules))
        print("[dev] 请先运行：python -m pip install -r requirements.txt")
        ok = False

    if shutil.which("npm") is None:
        print("[dev] 未找到 npm，请先安装 Node.js 并确认 npm 在 PATH 中。")
        ok = False

    if not (FRONTEND_DIR / "package.json").exists():
        print(f"[dev] 未找到前端 package.json：{FRONTEND_DIR / 'package.json'}")
        ok = False

    return ok


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def start_process(name: str, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.Popen[str]:
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    print(f"[dev] 启动 {name}: {' '.join(command)}", flush=True)
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creationflags,
    )

    def pipe_output() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            print(f"[{name}] {line}", end="", flush=True)

    threading.Thread(target=pipe_output, daemon=True).start()
    return process


def stop_process(name: str, process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    print(f"[dev] 正在关闭 {name}...", flush=True)
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    if os.name == "nt" and hasattr(signal, "SIGBREAK"):
        def raise_keyboard_interrupt(_signum: int, _frame: object) -> None:
            raise KeyboardInterrupt

        signal.signal(signal.SIGBREAK, raise_keyboard_interrupt)

    parser = argparse.ArgumentParser(description="同时启动本地 FastAPI 后端、Vite 前端和采集程序")
    collector_group = parser.add_mutually_exclusive_group()
    collector_group.add_argument(
        "--with-collector",
        action="store_true",
        help="兼容旧参数；采集程序现在默认启动",
    )
    collector_group.add_argument(
        "--without-collector",
        action="store_true",
        help="只启动后端和前端，不启动采集程序",
    )
    args = parser.parse_args()
    start_collector = not args.without_collector

    if not validate_environment(start_collector):
        return 1

    processes: list[tuple[str, subprocess.Popen[str]]] = []
    try:
        processes.append(
            (
                "backend",
                start_process(
                    "backend",
                    [
                        sys.executable,
                        "-u",
                        "-m",
                        "uvicorn",
                        "backend.api:app",
                        "--reload",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "8013",
                    ],
                    PROJECT_ROOT,
                ),
            )
        )
        processes.append(
            (
                "frontend",
                start_process("frontend", [npm_command(), "run", "dev"], FRONTEND_DIR),
            )
        )

        if start_collector:
            processes.append(
                (
                    "collector",
                    start_process(
                        "collector",
                        [sys.executable, "-u", "sgodds_collector.py", "run"],
                        PROJECT_ROOT,
                    ),
                )
            )

        print("[dev] 开发进程启动命令已发出。按 Ctrl+C 同时关闭所有进程。", flush=True)
        while True:
            for name, process in processes:
                code = process.poll()
                if code is not None:
                    print(f"[dev] {name} 已退出，退出码：{code}", flush=True)
                    return code
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[dev] 收到 Ctrl+C，准备关闭开发进程。", flush=True)
        return 130
    finally:
        for name, process in reversed(processes):
            stop_process(name, process)


if __name__ == "__main__":
    raise SystemExit(main())
