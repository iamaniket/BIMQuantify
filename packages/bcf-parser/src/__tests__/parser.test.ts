import { parseBcf } from '../index.js';
import { zipSync, strToU8 } from 'fflate';

function buildMinimalBcfZip(guid: string): Uint8Array {
  const markupXml = `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Topic Guid="${guid}" TopicType="Issue" TopicStatus="Open">
    <Title>Test Issue</Title>
    <CreationDate>2024-01-01T00:00:00Z</CreationDate>
    <CreationAuthor>test@example.com</CreationAuthor>
  </Topic>
</Markup>`;

  return zipSync({
    [`${guid}/markup.bcf`]: strToU8(markupXml),
    'bcf.version': strToU8('<Version VersionId="2.1" />'),
  });
}

describe('parseBcf', () => {
  const guid = 'a1b2c3d4-0000-0000-0000-000000000001';

  it('parses a minimal BCF zip with one topic', () => {
    const zip = buildMinimalBcfZip(guid);
    const result = parseBcf(zip);

    expect(result.version).toBe('2.1');
    expect(result.count).toBe(1);
    expect(result.topics).toHaveLength(1);

    const topic = result.topics[0]!;
    expect(topic.guid).toBe(guid);
    expect(topic.title).toBe('Test Issue');
    expect(topic.topicType).toBe('Issue');
    expect(topic.topicStatus).toBe('Open');
    expect(topic.creationAuthor).toBe('test@example.com');
    expect(topic.comments).toHaveLength(0);
    expect(topic.viewpoints).toHaveLength(0);
  });

  it('returns durationMs as a non-negative number', () => {
    const zip = buildMinimalBcfZip(guid);
    const result = parseBcf(zip);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
