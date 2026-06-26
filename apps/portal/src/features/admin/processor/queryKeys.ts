export const adminProcessorKey = ['admin', 'processor'] as const;

export const adminProcessorQueueKey = (): readonly ['admin', 'processor', 'queue'] =>
  ['admin', 'processor', 'queue'] as const;

export const adminProcessorActiveKey = (
  limit: number,
): readonly ['admin', 'processor', 'active', { limit: number }] =>
  ['admin', 'processor', 'active', { limit }] as const;
