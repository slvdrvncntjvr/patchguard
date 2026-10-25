const INSTANCE = 'https://workcybercentcurity.app.n8n.cloud';
const EXPECTED_WORKFLOW = 'vsZKzBRf7cYRZeub';

export function buildProjectOverview(workflow) {
  if (!workflow || workflow.id !== EXPECTED_WORKFLOW || !Array.isArray(workflow.nodes)) {
    throw new Error('The saved PATCHGUARD workflow snapshot is missing or invalid');
  }
  const config = workflow.nodes.find(node => node.name === 'Configuration — Repository and Safety Gates');
  const settings = Object.fromEntries((config?.parameters?.assignments?.assignments || []).map(field => [field.name, field.value]));
  if (!/^[A-Za-z0-9-]{1,39}$/.test(settings.owner || '') || !/^[A-Za-z0-9_.-]{1,100}$/.test(settings.repository || '') || ['.', '..'].includes(settings.repository)) {
    throw new Error('The saved repository configuration is invalid');
  }
  const githubNodes = workflow.nodes.filter(node => node.parameters?.nodeCredentialType === 'githubApi');
  const telegramNode = workflow.nodes.find(node => node.type === 'n8n-nodes-base.telegram');
  const hasTelegramCredential = Boolean(telegramNode?.credentials?.telegramApi?.id);
  const validChat = /^-?\d{1,20}$/.test(String(settings.telegramChatId || ''));
  return {
    repository: settings.owner + '/' + settings.repository,
    repositoryUrl: 'https://github.com/' + settings.owner + '/' + settings.repository,
    workflowUrl: INSTANCE + '/workflow/' + EXPECTED_WORKFLOW,
    snapshotUpdatedAt: workflow.updatedAt || null,
    monitoringEnabled: workflow.active === true,
    githubConfigured: githubNodes.length === 5 && githubNodes.every(node => Boolean(node.credentials?.githubApi?.id)),
    telegramConfigured: workflow.publicSetup?.telegramConfigured === true || (hasTelegramCredential && validChat),
    telegramEnabled: workflow.publicSetup?.telegramEnabled === true || (hasTelegramCredential && validChat && settings.telegramEnabled === true),
    dispatchApproved: settings.dryRun === false && ['dispatchEnabled', 'authSetupApproved', 'testsApproved', 'serializedExecutionApproved'].every(key => settings[key] === true),
    scanStatus: 'not-verified',
    vulnerabilityCount: null,
  };
}

export function healthPayload() {
  return { application: 'PATCHGUARD', status: 'ok', monitoring: 'not-verified' };
}
