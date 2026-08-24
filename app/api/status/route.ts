export async function GET() {
  return Response.json({
    network: process.env.STRATUM_CHAIN_ID ?? 'stratum-devnet-1',
    validator: process.env.STRATUM_VALIDATOR_ID ?? 'validator-c',
    address: process.env.STRATUM_VALIDATOR_ADDRESS ?? 'stratum1st4auqk78ftlg2r0u7qel24j7eezn9zx4yrztl',
    role: 'validator',
    status: 'online'
  });
}
