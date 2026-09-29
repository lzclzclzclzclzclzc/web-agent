"""MCP compatibility UI: explicit ask/converse controls live inside the document."""
import json
import os
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
process = subprocess.Popen(['node', 'test/browser-legacy-server.mjs'], cwd=root,
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
try:
    line = process.stdout.readline()
    if not line:
        raise RuntimeError(process.stderr.read())
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('WEB_AGENT_TEST_BROWSER', 'chrome'))
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.goto(json.loads(line)['url'])
        page.wait_for_load_state('networkidle')
        frame = page.frame_locator('section.canvas-view:not([hidden]) iframe')
        expect(frame.get_by_role('heading', name='保留在页面中的原始内容')).to_be_visible()
        expect(page.locator('main input,main textarea,main button,aside,header,footer')).to_have_count(0)
        frame.get_by_role('radio', name='方向 B').check()
        frame.get_by_role('spinbutton', name='训练轮数').fill('8')
        frame.get_by_role('textbox', name='补充意见').fill('保留 MCP 草稿')
        page.wait_for_timeout(300)
        page.reload()
        expect(frame.get_by_role('radio', name='方向 B')).to_be_checked()
        expect(frame.get_by_role('spinbutton', name='训练轮数')).to_have_value('8')
        expect(frame.get_by_role('textbox', name='补充意见')).to_have_value('保留 MCP 草稿')
        frame.get_by_role('button', name='提交页面表单').click()
        expect(frame.get_by_role('heading', name='继续补充')).to_be_visible()
        expect(frame.get_by_role('textbox', name='补充意见')).to_have_value('')
        frame.get_by_role('textbox', name='补充意见').fill('继续完成')
        frame.get_by_role('button', name='发送回复').click()
        expect(frame.get_by_role('heading', name='MCP 完成')).to_be_visible()
        expect(frame.locator('body')).to_contain_text('"selected":["b"]')
        expect(frame.locator('body')).to_contain_text('"epochs":8')
        expect(frame.locator('body')).to_contain_text('继续完成')
        browser.close()
        print('PASS: MCP controls in full-page canvas, refresh draft, structured answer, converse')
finally:
    if process.poll() is None:
        process.stdin.write('stop\n')
        process.stdin.flush()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
