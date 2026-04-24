'use client';

import React from 'react';
import type { BcfTopic } from '@bim-quantify/bcf-parser';

export interface BcfIssueListProps {
  topics: BcfTopic[];
  onSelect?: (topic: BcfTopic) => void;
}

const STATUS_COLORS: Record<string, string> = {
  Open: '#ef4444',
  'In Progress': '#f59e0b',
  Resolved: '#22c55e',
  Closed: '#6b7280',
};

/**
 * Renders a list of BCF topics/issues.
 */
export function BcfIssueList({ topics, onSelect }: BcfIssueListProps): React.ReactElement {
  if (topics.length === 0) {
    return <p style={{ color: '#6b7280' }}>No BCF issues found.</p>;
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {topics.map((topic) => {
        const statusColor = STATUS_COLORS[topic.topicStatus] ?? '#6b7280';
        const snapshot = topic.viewpoints[0]?.snapshotUrl;
        return (
          <li
            key={topic.guid}
            onClick={() => onSelect?.(topic)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: 12,
              marginBottom: 8,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              cursor: onSelect ? 'pointer' : 'default',
            }}
          >
            {snapshot && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={snapshot}
                alt="viewpoint"
                style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4 }}
              />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{topic.title}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: statusColor,
                    color: '#fff',
                  }}
                >
                  {topic.topicStatus}
                </span>
                <span style={{ color: '#6b7280' }}>{topic.topicType}</span>
                {topic.assignedTo && (
                  <span style={{ color: '#6b7280' }}>→ {topic.assignedTo}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
