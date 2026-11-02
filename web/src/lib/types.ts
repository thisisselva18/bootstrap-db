// Shapes returned by the API. Shared by route handlers and client components.

export type Status = "present" | "absent" | "late" | "excused";
export type Risk = "LOW" | "MEDIUM" | "HIGH";

export type StudentRow = {
  s_id: number;
  s_usn: string;
  s_name: string;
  email: string;
  branch: string | null;
  semester: number;
  g_id: number;
  colour_group: string;
  sessions: number;
  present: number;
  late_arrivals: number;
  absent: number;
  excused: number;
  attendance_pct: number;
  risk: Risk;
};

export type ScheduleItem = {
  schedule_id: number;
  day: number;
  a_id: number;
  activity: string;
  room: string | null;
  start_time: string;
  end_time: string;
  mentor: string | null;
  status: Status | null;
  check_in_time: string | null;
  check_out_time: string | null;
  minutes: number | null;
  rating: number | null;
  comments: string | null;
};

export type StudentDashboard = {
  profile: {
    s_id: number;
    s_usn: string;
    s_name: string;
    email: string;
    branch: string | null;
    semester: number;
    g_id: number;
    g_name: string;
    last_login: string | null;
  };
  stats: StudentRow;
  groupRank: { rank_in_group: number; group_size: number; group_avg_pct: number } | null;
  schedule: ScheduleItem[];
};

export type GroupStats = {
  g_id: number;
  g_name: string;
  students: number;
  present: number;
  late_arrivals: number;
  absent: number;
  excused: number;
  attendance_pct: number | null;
};

export type ActivityStats = {
  a_id: number;
  a_name: string;
  capacity: number;
  description: string | null;
  m_id: number | null;
  mentor: string | null;
  enrolled: number;
  attended: number;
  attendance_pct: number | null;
  avg_rating: number;
  responses: number;
};

export type MentorRow = {
  m_id: number;
  m_name: string;
  dept: string | null;
  designation: string | null;
  email: string;
  phone: string | null;
  activities: string | null;
  has_login: number;
};

export type TimetableSlot = {
  schedule_id: number;
  day: number;
  g_id: number;
  g_name: string;
  a_id: number;
  a_name: string;
  room: string | null;
  start_time: string;
  end_time: string;
  mentor: string | null;
};

export type RosterRow = {
  p_id: number;
  s_id: number;
  s_usn: string;
  s_name: string;
  branch: string | null;
  g_id: number;
  g_name: string;
  day: number;
  status: Status;
  check_in_time: string | null;
  check_out_time: string | null;
  minutes: number | null;
};

export type FeedbackRow = {
  f_id: number;
  s_id: number;
  s_usn: string;
  s_name: string;
  a_id: number;
  a_name: string;
  rating: number;
  comments: string | null;
  time: string;
  relevance?: number;
};

export type AuditRow = {
  log_id: number;
  changed_at: string;
  s_usn: string;
  s_name: string;
  activity: string;
  old_status: string | null;
  new_status: string | null;
  changed_by: string | null;
};

// ---- graph (Neo4j) -------------------------------------------------------

export type PeerRecommendation = {
  s_id: number;
  name: string;
  usn: string;
  branch: string | null;
  group: string | null;
  sharedInterests: string[];
  mutualConnections: number;
  jaccard: number;
  score: number;
  reasons: string[];
  attendance_pct?: number | null; // merged in from MySQL
};

export type SimilarStudent = {
  s_id: number;
  name: string;
  branch: string | null;
  group: string | null;
  sharedInterests: number;
  coRated: number;
  ratingAgreement: number | null;
  sameStatusCount: number;
  similarity: number;
};

export type ActivityRecommendation = {
  a_id: number;
  name: string;
  mentor: string | null;
  supporters: number;
  supporterNames: string[];
  score: number;
};

export type MentorRecommendation = {
  m_id: number;
  name: string;
  dept: string | null;
  viaActivities: string[];
  peers: number;
};

export type Connection = { s_id: number; name: string; branch: string | null; group: string | null; since: string | null };

export type EgoGraph = {
  nodes: Array<{ id: string; label: string; kind: "me" | "student" | "activity" | "mentor" | "group" | "branch" }>;
  edges: Array<{ source: string; target: string; type: string }>;
};

export type GraphPath = {
  length: number;
  nodes: Array<{ kind: string; label: string }>;
  rels: string[];
} | null;
