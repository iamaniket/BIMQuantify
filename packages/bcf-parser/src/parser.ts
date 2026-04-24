import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { BcfComment, BcfParseResult, BcfTopic, BcfViewpointReference } from './types.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: true,
});

/**
 * Parse a BCF 2.1 zip file.
 *
 * @param buffer - Raw bytes of the `.bcfzip` file
 * @returns Parsed topics and metadata
 */
export function parseBcf(buffer: Uint8Array): BcfParseResult {
  const start = Date.now();
  const files = unzipSync(buffer);

  // Detect version
  let version = '2.1';
  const versionEntry = files['bcf.version'];
  if (versionEntry) {
    try {
      const vDoc = xmlParser.parse(strFromU8(versionEntry)) as Record<string, unknown>;
      const versionNode = vDoc['Version'] as Record<string, unknown> | undefined;
      version = (versionNode?.['@_VersionId'] as string | undefined) ?? version;
    } catch {
      // Ignore parse errors for version file
    }
  }

  // Find topic GUIDs from directory structure  (each topic is a folder named by its GUID)
  const topicGuids = new Set<string>();
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    if (parts.length >= 2 && parts[0]) {
      topicGuids.add(parts[0]);
    }
  }

  const topics: BcfTopic[] = [];

  for (const guid of topicGuids) {
    const markupBytes = files[`${guid}/markup.bcf`];
    if (!markupBytes) continue;

    try {
      const topic = parseMarkup(guid, strFromU8(markupBytes), files);
      topics.push(topic);
    } catch {
      // Skip malformed topics
    }
  }

  return {
    version,
    topics,
    count: topics.length,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMarkup(
  guid: string,
  xml: string,
  files: Record<string, Uint8Array>,
): BcfTopic {
  const doc = xmlParser.parse(xml) as Record<string, unknown>;
  const markup = (doc['Markup'] ?? doc['markup']) as Record<string, unknown>;
  const topicNode = (markup['Topic'] ?? markup['topic']) as Record<string, unknown> ?? {};
  const header = markup['Header'] as Record<string, unknown> | undefined;

  void header; // reserved for future header processing

  const topicType = ((topicNode['@_TopicType'] as string | undefined) ?? 'Issue').trim();
  const topicStatus = ((topicNode['@_TopicStatus'] as string | undefined) ?? 'Open').trim();
  const title = String(topicNode['Title'] ?? topicNode['title'] ?? '').trim();
  const description = stringOrNull(topicNode['Description'] ?? topicNode['description']);
  const creationDate = String(topicNode['CreationDate'] ?? topicNode['creationDate'] ?? '').trim();
  const creationAuthor = String(topicNode['CreationAuthor'] ?? topicNode['creationAuthor'] ?? '').trim();
  const assignedTo = stringOrNull(topicNode['AssignedTo'] ?? topicNode['assignedTo']);
  const dueDate = stringOrNull(topicNode['DueDate'] ?? topicNode['dueDate']);
  const priority = stringOrNull(topicNode['Priority'] ?? topicNode['priority']);

  const labelsRaw = topicNode['Labels'] ?? topicNode['labels'];
  const labels: string[] = Array.isArray(labelsRaw)
    ? labelsRaw.map(String)
    : labelsRaw
    ? [String(labelsRaw)]
    : [];

  // Comments
  const comments: BcfComment[] = [];
  const commentsRaw = markup['Comment'] ?? markup['comment'];
  const commentNodes = Array.isArray(commentsRaw)
    ? commentsRaw
    : commentsRaw
    ? [commentsRaw]
    : [];
  for (const c of commentNodes as Record<string, unknown>[]) {
    comments.push({
      guid: String(c['@_Guid'] ?? c['Guid'] ?? c['guid'] ?? ''),
      date: String(c['Date'] ?? c['date'] ?? '').trim(),
      author: String(c['Author'] ?? c['author'] ?? '').trim(),
      comment: String(c['Comment'] ?? c['comment'] ?? '').trim(),
      viewpointGuid: stringOrNull(
        (c['Viewpoint'] as Record<string, unknown> | undefined)?.['@_Guid'],
      ) ?? undefined,
    });
  }

  // Viewpoints
  const viewpoints: BcfViewpointReference[] = [];
  const vpRaw = markup['Viewpoints'] ?? markup['viewpoints'];
  const vpNodes = Array.isArray(vpRaw) ? vpRaw : vpRaw ? [vpRaw] : [];
  for (const vp of vpNodes as Record<string, unknown>[]) {
    const vpGuid = String(vp['@_Guid'] ?? vp['Guid'] ?? vp['guid'] ?? '');
    const vpFile = String(vp['Viewpoint'] ?? vp['viewpoint'] ?? '').trim();
    const snapshotFile = String(vp['Snapshot'] ?? vp['snapshot'] ?? '').trim();

    // Check whether a snapshot PNG exists in the zip
    const snapshotBytes = files[`${guid}/${snapshotFile}`];
    let snapshotUrl: string | undefined;
    if (snapshotBytes) {
      const b64 = Buffer.from(snapshotBytes).toString('base64');
      snapshotUrl = `data:image/png;base64,${b64}`;
    }

    viewpoints.push({
      guid: vpGuid,
      viewpointUrl: vpFile ? `${guid}/${vpFile}` : undefined,
      snapshotUrl,
    });
  }

  return {
    guid,
    topicType,
    topicStatus,
    title,
    description,
    creationDate,
    creationAuthor,
    assignedTo,
    dueDate,
    priority,
    labels,
    comments,
    viewpoints,
  };
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}
