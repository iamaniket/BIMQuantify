import { z } from 'zod';

// ---------------------------------------------------------------------------
// Viewpoint
// ---------------------------------------------------------------------------

export const BcfVec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const BcfComponentsSchema = z.object({
  default_visibility: z.boolean(),
  visibility_exceptions: z.array(z.string()),
  selection: z.array(z.string()),
});

export const BcfClippingPlaneSchema = z.object({
  location: BcfVec3Schema,
  direction: BcfVec3Schema,
});

export const BcfViewpointReadSchema = z.object({
  id: z.string().uuid(),
  guid: z.string(),
  index_in_topic: z.number(),
  camera_type: z.string(),
  camera_view_point: z.record(z.string(), z.number()),
  camera_direction: z.record(z.string(), z.number()),
  camera_up_vector: z.record(z.string(), z.number()),
  field_of_view: z.union([z.number(), z.null()]),
  field_of_height: z.union([z.number(), z.null()]),
  components: z.union([z.record(z.string(), z.unknown()), z.null()]),
  clipping_planes: z.union([z.array(z.unknown()), z.null()]),
  snapshot_url: z.union([z.string(), z.null()]).optional(),
  is_2d: z.boolean(),
  view_state_2d: z.union([z.record(z.string(), z.unknown()), z.null()]),
  linked_file_id: z.union([z.string().uuid(), z.null()]),
  created_at: z.string(),
});

export type BcfViewpointRead = z.infer<typeof BcfViewpointReadSchema>;

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

export const BcfCommentReadSchema = z.object({
  id: z.string().uuid(),
  guid: z.string(),
  comment_text: z.string(),
  author: z.string(),
  date: z.string(),
  modified_author: z.union([z.string(), z.null()]),
  modified_date: z.union([z.string(), z.null()]),
  viewpoint_guid: z.union([z.string(), z.null()]),
  created_by_user_id: z.union([z.string().uuid(), z.null()]),
  created_at: z.string(),
});

export type BcfCommentRead = z.infer<typeof BcfCommentReadSchema>;

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

export const BcfTopicReadSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  guid: z.string(),
  title: z.string(),
  description: z.union([z.string(), z.null()]),
  topic_type: z.string(),
  topic_status: z.string(),
  priority: z.union([z.string(), z.null()]),
  stage: z.union([z.string(), z.null()]),
  assigned_to: z.union([z.string(), z.null()]),
  labels: z.union([z.array(z.string()), z.null()]),
  due_date: z.union([z.string(), z.null()]),
  creation_author: z.string(),
  creation_date: z.string(),
  modified_author: z.union([z.string(), z.null()]),
  modified_date: z.union([z.string(), z.null()]),
  linked_finding_id: z.union([z.string().uuid(), z.null()]),
  linked_model_id: z.union([z.string().uuid(), z.null()]),
  created_by_user_id: z.string().uuid(),
  bcf_version: z.string(),
  import_source: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
  viewpoints: z.array(BcfViewpointReadSchema),
  comments: z.array(BcfCommentReadSchema),
});

export type BcfTopicRead = z.infer<typeof BcfTopicReadSchema>;

export const BcfTopicSummarySchema = z.object({
  id: z.string().uuid(),
  guid: z.string(),
  title: z.string(),
  topic_type: z.string(),
  topic_status: z.string(),
  priority: z.union([z.string(), z.null()]),
  assigned_to: z.union([z.string(), z.null()]),
  creation_author: z.string(),
  creation_date: z.string(),
  linked_finding_id: z.union([z.string().uuid(), z.null()]),
  snapshot_url: z.union([z.string(), z.null()]).optional(),
  created_at: z.string(),
});

export type BcfTopicSummary = z.infer<typeof BcfTopicSummarySchema>;

export const BcfTopicListSchema = z.array(BcfTopicSummarySchema);

export type BcfTopicList = z.infer<typeof BcfTopicListSchema>;

// ---------------------------------------------------------------------------
// Create / Update inputs
// ---------------------------------------------------------------------------

export const BcfViewpointCreateSchema = z.object({
  guid: z.string().max(36),
  index_in_topic: z.number().default(0),
  camera_type: z.string().max(20),
  camera_view_point: BcfVec3Schema,
  camera_direction: BcfVec3Schema,
  camera_up_vector: BcfVec3Schema,
  field_of_view: z.union([z.number(), z.null()]).optional(),
  field_of_height: z.union([z.number(), z.null()]).optional(),
  components: BcfComponentsSchema.optional(),
  clipping_planes: z.array(BcfClippingPlaneSchema).default([]),
  is_2d: z.boolean().optional().default(false),
  view_state_2d: z
    .object({
      center_x: z.number().default(0),
      center_y: z.number().default(0),
      zoom: z.number().default(1),
      visible_layers: z.array(z.string()).default([]),
      file_type: z.string().default('dxf'),
    })
    .optional(),
  linked_file_id: z.union([z.string().uuid(), z.null()]).optional(),
});

export type BcfViewpointCreateInput = z.infer<typeof BcfViewpointCreateSchema>;

export const BcfTopicCreateSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.union([z.string().max(4000), z.null()]).optional(),
  topic_type: z.string().max(50).default('Issue'),
  topic_status: z.string().max(50).default('Open'),
  priority: z.union([z.string().max(50), z.null()]).optional(),
  stage: z.union([z.string().max(50), z.null()]).optional(),
  assigned_to: z.union([z.string().max(255), z.null()]).optional(),
  labels: z.array(z.string()).default([]),
  due_date: z.union([z.string(), z.null()]).optional(),
  linked_finding_id: z.union([z.string().uuid(), z.null()]).optional(),
  linked_model_id: z.union([z.string().uuid(), z.null()]).optional(),
  viewpoint: BcfViewpointCreateSchema.optional(),
});

export type BcfTopicCreateInput = z.infer<typeof BcfTopicCreateSchema>;

export const BcfTopicUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.union([z.string().max(4000), z.null()]).optional(),
  topic_type: z.string().max(50).optional(),
  topic_status: z.string().max(50).optional(),
  priority: z.union([z.string().max(50), z.null()]).optional(),
  stage: z.union([z.string().max(50), z.null()]).optional(),
  assigned_to: z.union([z.string().max(255), z.null()]).optional(),
  labels: z.union([z.array(z.string()), z.null()]).optional(),
  due_date: z.union([z.string(), z.null()]).optional(),
  linked_finding_id: z.union([z.string().uuid(), z.null()]).optional(),
  linked_model_id: z.union([z.string().uuid(), z.null()]).optional(),
});

export type BcfTopicUpdateInput = z.infer<typeof BcfTopicUpdateSchema>;

export const BcfCommentCreateSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  viewpoint_guid: z.union([z.string().max(36), z.null()]).optional(),
});

export type BcfCommentCreateInput = z.infer<typeof BcfCommentCreateSchema>;

// ---------------------------------------------------------------------------
// Import response
// ---------------------------------------------------------------------------

export const BcfImportResponseSchema = z.object({
  imported_count: z.number(),
  topics: z.array(BcfTopicReadSchema),
  warnings: z.array(z.string()),
});

export type BcfImportResponse = z.infer<typeof BcfImportResponseSchema>;

// ---------------------------------------------------------------------------
// Snapshot upload
// ---------------------------------------------------------------------------

export const BcfSnapshotUploadResponseSchema = z.object({
  upload_url: z.string(),
  storage_key: z.string(),
});

export type BcfSnapshotUploadResponse = z.infer<typeof BcfSnapshotUploadResponseSchema>;
