"""Full-viewport canvas acceptance. Build first; requires Playwright + Chrome."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'
RESULTS.mkdir(exist_ok=True)
temp = tempfile.TemporaryDirectory(prefix='web-agent-browser-')
environment = dict(os.environ, WEB_AGENT_TEST_DB=str(Path(temp.name) / 'test.sqlite'))
process = None


def start_server():
    global process
    process = subprocess.Popen(['node', 'test/browser-server.mjs'], cwd=ROOT, env=environment,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    line = process.stdout.readline()
    if not line:
        raise RuntimeError(process.stderr.read())
    return json.loads(line)['url']


def stop_server():
    if process and process.poll() is None:
        process.stdin.write('stop\n')
        process.stdin.flush()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def assert_canvas_only(page):
    expect(page.locator('aside,header,footer,[role="tablist"],main textarea,main input,main button')).to_have_count(0)
    expect(page.locator('dialog')).to_have_count(0)
    box = page.locator('section.canvas-view:not([hidden]) iframe').bounding_box()
    assert box == dict(x=0, y=0, **page.viewport_size), box


try:
    url = start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('WEB_AGENT_TEST_BROWSER', 'chrome'))
        page = browser.new_page(viewport={'width': 1440, 'height': 960})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        page.wait_for_load_state('networkidle')
        (RESULTS / 'initial-dom.html').write_text(page.content(), encoding='utf-8')
        page.screenshot(path=str(RESULTS / '01-workspace.png'), full_page=True)
        print('Bootstrap buttons:', page.get_by_role('button').all_text_contents())
        page.get_by_role('textbox', name='初始任务').fill('浏览器全屏画布验收')
        page.get_by_role('button', name='开始', exact=True).click()
        expect(page.locator('iframe')).to_have_count(3)
        frame = page.frame_locator('iframe[title="方案选择"]')
        expect(frame.get_by_role('button', name='确认方案')).to_be_enabled()
        assert_canvas_only(page)
        frame.get_by_role('button', name='方案 B · 紧凑').click()
        frame.get_by_role('textbox', name='设计意见').fill('保留这个草稿，采用紧凑布局')
        frame.get_by_role('textbox', name='下一步要求').fill('页面内尚未发送的草稿')
        page.wait_for_timeout(300)
        frame.get_by_role('button', name='训练指标', exact=True).click()
        metrics = page.frame_locator('iframe[title="训练指标"]')
        expect(metrics.locator('#value')).to_contain_text('epoch')
        first_metric = metrics.locator('#value').inner_text()
        page.wait_for_timeout(500)
        assert metrics.locator('#value').inner_text() != first_metric
        assert_canvas_only(page)
        # Reload retains the agent-selected page, draft, and pending input.
        page.reload()
        expect(page.locator('section.canvas-view:not([hidden]) iframe')).to_have_attribute('title', '训练指标')
        metrics.get_by_role('button', name='方案选择', exact=True).click()
        expect(frame.get_by_role('textbox', name='设计意见')).to_have_value('保留这个草稿，采用紧凑布局')
        expect(frame.get_by_role('textbox', name='下一步要求')).to_have_value('页面内尚未发送的草稿')
        expect(frame.get_by_role('button', name='方案 B · 紧凑')).to_have_class('selected')
        page.screenshot(path=str(RESULTS / '02-interaction.png'), full_page=True)
        # Source spoofing must not open host controls or dispatch task actions.
        state = page.request.get(url.split('/#')[0] + '/api/state').json()
        task = state['tasks'][0]
        artifact = next(a for a in task['artifacts'] if a['id'] == task['activeArtifactId'])
        page.evaluate('(a)=>window.postMessage({__webAgent:true,id:a.id,version:a.version,type:"controls"},"*")', artifact)
        expect(page.locator('dialog')).to_have_count(0)
        hidden = next(f for f in page.frames if f != page.main_frame and f.locator('#value').count())
        rejected = hidden.evaluate('async()=>{try{await webagent.sendMessage("complete hidden injection");return false}catch(e){return true}}')
        assert rejected
        # Accepted submission with a lost response can be retried without another turn.
        accepted = []
        def lose_response(route):
            accepted.append(route.fetch().status)
            route.abort('failed')
        page.route('**/api/inputs/*/submit', lose_response, times=1)
        frame.get_by_role('button', name='确认方案').click()
        expect(page.get_by_role('button', name='重试上次提交')).to_be_visible()
        assert accepted == [200]
        page.get_by_role('button', name='重试上次提交').click()
        expect(page.get_by_role('button', name='重试上次提交')).to_have_count(0)
        frame.get_by_role('button', name='架构评审', exact=True).click()
        graph = page.frame_locator('iframe[title="架构评审"]')
        expect(graph.get_by_role('button', name='提交架构意见')).to_be_enabled()
        graph.locator('#api').click()
        graph.get_by_role('textbox', name='架构意见').fill('拆分接口层和数据层')
        graph.get_by_role('button', name='提交架构意见').click()
        expect(page.locator('section.canvas-view:not([hidden]) iframe')).to_have_attribute('title', '已修改的方案')
        frame = page.frame_locator('iframe[title="已修改的方案"]')
        expect(frame.get_by_role('textbox', name='设计意见')).to_have_value('保留这个草稿，采用紧凑布局')
        assert_canvas_only(page)
        # Escape opens an on-demand host dialog even while iframe owns focus.
        frame.get_by_role('textbox', name='设计意见').focus()
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog', name='任务控制')).to_be_visible()
        expect(page.get_by_text('已收到架构反馈，已继续修改对应方案。', exact=True)).to_be_visible()
        page.get_by_role('button', name='从 Codex 读取历史').click()
        expect(page.get_by_role('button', name='历史记录已加载')).to_be_visible()
        page.get_by_role('button', name='返回画布').click()
        # Agent-authored composer starts a new turn; approval is a trusted modal.
        frame.get_by_role('textbox', name='下一步要求').fill('approvals 审批验收')
        frame.get_by_role('button', name='继续这个对话').click()
        try:
            expect(page.get_by_role('region', name='权限确认')).to_be_visible()
        except Exception:
            print('Page action status:', frame.locator('#next-status').inner_text())
            diagnostic = page.request.get(url.split('/#')[0] + '/api/state').json()['tasks'][0]
            print('Task state:', {k: diagnostic[k] for k in ['status', 'requests', 'items']})
            print('Browser errors:', errors)
            raise
        page.screenshot(path=str(RESULTS / '03-approval.png'), full_page=True)
        page.get_by_role('button', name='仅允许本次').click()
        page.get_by_role('textbox', name='采用哪个方向？').fill('方案 B')
        page.get_by_role('button', name='发送回答').click()
        expect(page.locator('dialog')).to_have_count(0)
        frame.get_by_role('textbox', name='下一步要求').fill('wait 停止验收')
        frame.get_by_role('button', name='继续这个对话').click()
        expect(page.locator('iframe')).to_have_count(6)
        current = page.frame_locator('section.canvas-view:not([hidden]) iframe')
        expect(current.get_by_role('button', name='确认方案')).to_be_enabled()
        current.get_by_role('textbox', name='设计意见').focus()
        page.keyboard.press('Escape')
        page.get_by_role('button', name='停止任务').click()
        expect(page.get_by_text('已停止 · 可继续', exact=False)).to_be_visible()
        page.get_by_role('button', name='返回画布').click()
        expect(current.get_by_role('button', name='确认方案')).to_be_disabled()
        before = page.request.get(url.split('/#')[0] + '/api/state').json()['tasks'][0]
        stop_server()
        url = start_server()
        page.goto(url)
        expect(page.locator('iframe')).to_have_count(6)
        restored = page.request.get(url.split('/#')[0] + '/api/state').json()['tasks'][0]
        assert restored['id'] == before['id'] and restored['activeArtifactId'] == before['activeArtifactId']
        current = page.frame_locator('section.canvas-view:not([hidden]) iframe')
        expect(current.get_by_role('button', name='确认方案')).to_be_disabled()
        current.get_by_role('textbox', name='下一步要求').fill('complete 恢复后继续')
        current.get_by_role('button', name='继续这个对话').click()
        current.get_by_role('textbox', name='下一步要求').focus()
        page.keyboard.press('Escape')
        expect(page.get_by_text('已完成', exact=True).last).to_be_visible()
        page.get_by_role('button', name='返回画布').click()
        page.set_viewport_size({'width': 390, 'height': 844})
        assert_canvas_only(page)
        page.screenshot(path=str(RESULTS / '04-narrow.png'), full_page=True)
        assert not errors, errors
        browser.close()
        print('PASS: edge-to-edge canvas, no persistent shell, agent navigation/composer, data, drafts, dedup, source isolation, approval, stop, restart/resume, history, mobile viewport')
finally:
    stop_server()
    temp.cleanup()
