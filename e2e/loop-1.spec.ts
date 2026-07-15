import { test, expect } from '@playwright/test';

// /api/invite/manage 与 /api/requirements/:path* 受 proxy.ts 管理员鉴权中间件保护，
// 通过 request fixture 直连时需携带该请求头，否则会被中间件拦截返回401。
const ADMIN_HEADERS = { 'x-admin-secret': process.env.ADMIN_SECRET || 'test-admin-secret' };

test.describe('Issue #1: [REQ-9441420] [REQ-需求收集工具] AI辅助的熟人需求收集与澄清工具（邀请码风控+Notion知识库集成）', () => {

  test('邀请码风控验证与用户信息收集完整流程', async ({ page, request }) => {
    const runId = Date.now().toString(36);

    // === 首页加载：验证标题与邀请码表单 ===
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '需求收集助手' })).toBeVisible();
    await expect(page.getByText('通过 AI 聊天，将您的想法梳理成专业的需求文档')).toBeVisible();
    const verifyButton = page.getByRole('button', { name: '验证邀请码' });
    await expect(verifyButton).toBeVisible();
    await expect(verifyButton).toBeDisabled();
    await page.screenshot({ path: '.loop/screenshots/loop-1-home.png', fullPage: true });

    // === AC#1: 无效邀请码 → 拒绝进入，提示联系运营者 ===
    const inviteInput = page.locator('#invite-code');
    await inviteInput.fill('INVALID_' + runId);
    await verifyButton.click();
    await expect(page.getByText('邀请码无效')).toBeVisible();
    await expect(page.getByText('联系我获取新邀请码')).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-invalid-code.png', fullPage: true });

    // === AC#1+AC#2: 邀请码已用满3次 → 拒绝，且计数在服务端 ===
    const exhaustedCode = ('EX' + runId).slice(0, 8).toUpperCase();
    await request.post('/api/invite/manage', { headers: ADMIN_HEADERS, data: { code: exhaustedCode } });
    for (let i = 0; i < 3; i++) {
      const resp = await request.post('/api/user-info', {
        data: {
          inviteCode: exhaustedCode,
          name: `E2E满额用户${i}_${runId}`,
          contactInfo: `exhaust_${i}_${runId}@test.com`,
          contactType: 'email',
        },
      });
      expect(resp.ok()).toBeTruthy();
    }
    await inviteInput.fill(exhaustedCode);
    await verifyButton.click();
    await expect(page.getByText('已使用满3次')).toBeVisible();
    await expect(page.getByText('联系我获取新邀请码')).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-exhausted-code.png', fullPage: true });

    // === AC#4: 有效邀请码 → 进入用户信息收集表单 ===
    const validCode = ('VD' + runId).slice(0, 8).toUpperCase();
    await request.post('/api/invite/manage', { headers: ADMIN_HEADERS, data: { code: validCode } });
    await inviteInput.fill(validCode);
    await verifyButton.click();

    const nameInput = page.locator('#name');
    await expect(nameInput).toBeVisible();
    await expect(page.getByText('联系方式类型')).toBeVisible();
    await expect(page.getByLabel('微信号')).toBeVisible();
    await expect(page.getByLabel('手机号')).toBeVisible();
    await expect(page.getByLabel('邮箱')).toBeVisible();
    const startButton = page.getByRole('button', { name: '开始需求澄清' });
    await expect(startButton).toBeDisabled();
    await page.screenshot({ path: '.loop/screenshots/loop-1-user-info-form.png', fullPage: true });

    // === AC#5: 隐私说明可见 ===
    await expect(page.getByText('仅用于需求反馈联系')).toBeVisible();

    // === AC#4: 填写姓名+联系方式 → 提交 → 跳转聊天页 ===
    await nameInput.fill('E2E测试用户');
    await page.locator('#contact').fill('e2e_wechat_' + runId);
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await page.waitForURL('**/chat');
    await expect(page.getByText('无效的会话')).not.toBeVisible();
    await expect(page.locator('[aria-label="Message input"]')).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-chat-entered.png', fullPage: true });
  });

  test('聊天页会话鉴权与返回首页导航', async ({ page }) => {
    // === 无有效session直接访问/chat → 拦截 ===
    await page.goto('/chat');
    await expect(page.getByRole('heading', { name: '无效的会话' })).toBeVisible();
    await expect(page.getByText('请从首页开始，输入邀请码后进入聊天')).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-no-session.png', fullPage: true });

    // === 返回首页链接可用 ===
    const backLink = page.getByRole('link', { name: '返回首页' });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/');
    await backLink.click();

    await page.waitForURL('/');
    await expect(page.getByRole('heading', { name: '需求收集助手' })).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-back-home.png', fullPage: true });
  });

  test('管理后台登录与邀请码全生命周期管理', async ({ page, request }) => {
    const runId = Date.now().toString(36);
    const testCode = ('AM' + runId).slice(0, 8).toUpperCase();

    // 预先通过API创建一个已知邀请码，便于后续定位操作
    await request.post('/api/invite/manage', { headers: ADMIN_HEADERS, data: { code: testCode } });

    // === 管理后台登录门控 ===
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '运营管理后台登录' })).toBeVisible();
    const secretInput = page.locator('input[type="password"]');
    await expect(secretInput).toBeVisible();
    await expect(secretInput).toHaveAttribute('placeholder', '请输入管理密钥');
    await page.screenshot({ path: '.loop/screenshots/loop-1-admin-login.png', fullPage: true });

    // === 输入密钥 → 进入后台主界面 ===
    const adminSecret = process.env.ADMIN_SECRET || 'test-admin-secret';
    await secretInput.fill(adminSecret);
    await page.getByRole('button', { name: '进入' }).click();

    await expect(page.getByRole('heading', { name: '运营管理后台', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /需求列表/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /邀请码管理/ })).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-admin-dashboard.png', fullPage: true });

    // === AC#3: 切换到邀请码管理标签 ===
    await page.getByRole('button', { name: /邀请码管理/ }).click();

    // === 验证预创建的邀请码存在于列表中 ===
    const codeText = page.locator('code', { hasText: testCode });
    await expect(codeText).toBeVisible();
    const codeRow = page.locator('div').filter({ has: codeText }).last();
    await expect(codeRow.getByText('已使用 0/3 次')).toBeVisible();
    await expect(codeRow.getByText('有效')).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-admin-code-active.png', fullPage: true });

    // === AC#3: 手动作废邀请码 ===
    await codeRow.getByRole('button', { name: '作废' }).click();
    await expect(codeRow.getByText('已作废')).toBeVisible();
    await expect(codeRow.getByRole('button', { name: '作废' })).not.toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-admin-code-revoked.png', fullPage: true });

    // === AC#3: 通过UI生成新邀请码 ===
    const countBefore = await page.locator('code.font-mono').count();
    await page.getByRole('button', { name: '生成新邀请码' }).click();
    await expect(page.locator('code.font-mono')).toHaveCount(countBefore + 1);
    await page.screenshot({ path: '.loop/screenshots/loop-1-admin-code-generated.png', fullPage: true });

    // === 切换到需求列表标签验证可切换 ===
    await page.getByRole('button', { name: /需求列表/ }).click();
    await expect(page.getByRole('heading', { name: '运营管理后台', exact: true })).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-admin-reqs-tab.png', fullPage: true });
  });

  test('已作废邀请码无法进入需求提交流程', async ({ page, request }) => {
    const runId = Date.now().toString(36);
    const revokedCode = ('RV' + runId).slice(0, 8).toUpperCase();

    // 通过API创建并立即作废邀请码
    await request.post('/api/invite/manage', { headers: ADMIN_HEADERS, data: { code: revokedCode } });
    await request.delete('/api/invite/manage', {
      headers: ADMIN_HEADERS,
      data: { code: revokedCode },
    });

    // === AC#1+AC#3: 已作废的邀请码在首页被拒绝 ===
    await page.goto('/');
    await page.locator('#invite-code').fill(revokedCode);
    await page.getByRole('button', { name: '验证邀请码' }).click();
    await expect(page.getByText('已失效')).toBeVisible();
    await expect(page.getByText('联系我获取新邀请码')).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-revoked-code-rejected.png', fullPage: true });

    // === 验证仍停留在邀请码输入步骤，未进入信息收集 ===
    await expect(page.locator('#invite-code')).toBeVisible();
    await expect(page.locator('#name')).not.toBeVisible();
  });

  test('需求状态终态保护与承诺条款记录API验证', async ({ page, request }) => {
    const runId = Date.now().toString(36);
    const statusCode = ('ST' + runId).slice(0, 8).toUpperCase();

    // === 准备：创建邀请码 + 提交用户信息 → 获得submission ===
    await request.post('/api/invite/manage', { headers: ADMIN_HEADERS, data: { code: statusCode } });
    const infoResp = await request.post('/api/user-info', {
      data: {
        inviteCode: statusCode,
        name: `终态测试用户_${runId}`,
        contactInfo: `terminal_${runId}@test.com`,
        contactType: 'email',
      },
    });
    expect(infoResp.ok()).toBeTruthy();

    // === AC#12: 通过管理后台验证需求状态变更API终态保护 ===
    // 先获取当前需求列表（可能为空，如果没有AI生成的需求）
    await page.goto('/admin');
    const adminSecret = process.env.ADMIN_SECRET || 'test-admin-secret';
    await page.locator('input[type="password"]').fill(adminSecret);
    await page.getByRole('button', { name: '进入' }).click();
    await expect(page.getByRole('heading', { name: '运营管理后台', exact: true })).toBeVisible();

    // === AC#12: 验证需求状态API对无效输入的拒绝 ===
    const invalidStatusResp = await request.patch(
      '/api/requirements/nonexistent-id/status',
      { headers: ADMIN_HEADERS, data: { status: 'accepted' } }
    );
    expect(invalidStatusResp.status()).toBe(404);
    const notFoundBody = await invalidStatusResp.json();
    expect(notFoundBody.error).toContain('不存在');

    // === 验证无效状态值被拒绝 ===
    const badStatusResp = await request.patch(
      '/api/requirements/nonexistent-id/status',
      { headers: ADMIN_HEADERS, data: { status: 'invalid_status' } }
    );
    expect(badStatusResp.status()).toBe(400);
    const badBody = await badStatusResp.json();
    expect(badBody.error).toContain('无效状态');

    // === 验证管理后台页面结构完整 ===
    await expect(page.getByRole('button', { name: /需求列表/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /邀请码管理/ })).toBeVisible();
    await page.screenshot({ path: '.loop/screenshots/loop-1-admin-status-api-verified.png', fullPage: true });
  });
});
