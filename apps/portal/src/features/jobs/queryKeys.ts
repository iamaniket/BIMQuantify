export const jobsKey = (projectId: string) => ['projects', projectId, 'jobs'] as const;

export const jobKey = (jobId: string) => ['jobs', jobId] as const;
