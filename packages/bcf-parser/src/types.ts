/** BCF 2.1 topic viewpoint reference */
export interface BcfViewpointReference {
  guid: string;
  snapshotUrl?: string;
  viewpointUrl?: string;
}

/** BCF 2.1 comment */
export interface BcfComment {
  guid: string;
  date: string;
  author: string;
  comment: string;
  viewpointGuid?: string;
}

/** BCF 2.1 topic (issue) */
export interface BcfTopic {
  guid: string;
  topicType: string;
  topicStatus: string;
  title: string;
  description: string | null;
  creationDate: string;
  creationAuthor: string;
  assignedTo: string | null;
  dueDate: string | null;
  priority: string | null;
  labels: string[];
  comments: BcfComment[];
  viewpoints: BcfViewpointReference[];
}

/** Result of parsing a BCF zip archive */
export interface BcfParseResult {
  version: string;
  topics: BcfTopic[];
  count: number;
  durationMs: number;
}
