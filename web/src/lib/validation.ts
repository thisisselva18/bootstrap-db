import { z } from "zod";

// Request validation. These mirror the database constraints so users get a
// clear message early; the database still enforces every rule itself.

const personName = z
  .string()
  .trim()
  .min(2, "Name must have at least 2 characters")
  .max(80)
  .regex(/^[\p{L}][\p{L} .'-]*$/u, "Name may contain only letters, spaces, . ' and -");

const email = z.string().trim().toLowerCase().max(120).pipe(z.email("Enter a valid email address"));

const id = z.coerce.number().int().positive();

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use 24-hour HH:MM time")
  .transform((t) => (t.length === 5 ? `${t}:00` : t));

const password = z
  .string()
  .min(8, "Password must have at least 8 characters")
  .max(72, "Password must have at most 72 characters") // bcrypt only reads 72 bytes
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a digit");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(200),
});

export const passwordChangeSchema = z
  .object({ currentPassword: z.string().min(1), newPassword: password })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must differ from the current one",
    path: ["newPassword"],
  });

export const studentCreateSchema = z.object({
  usn: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,15}$/, "USN must be 6-15 letters or digits"),
  name: personName,
  email,
  branch: z.string().trim().min(2).max(60),
  semester: z.coerce.number().int().min(1).max(8),
  groupId: id,
  password,
});

export const studentUpdateSchema = z
  .object({
    name: personName,
    email,
    branch: z.string().trim().min(2).max(60),
    semester: z.coerce.number().int().min(1).max(8),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const transferSchema = z.object({ groupId: id });

export const studentListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  groupId: id.optional(),
  branch: z.string().trim().max(60).optional(),
  semester: z.coerce.number().int().min(1).max(8).optional(),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  sort: z.enum(["name", "usn", "attendance", "group"]).default("usn"),
});

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 -]{10,15}$/, "Phone must be 10-15 digits");

export const mentorCreateSchema = z.object({
  name: personName,
  dept: z.string().trim().max(60).optional(),
  designation: z.string().trim().max(50).optional(),
  email,
  phone: phone.optional(),
  password: password.optional(), // when present a mentor login is created too
});

export const mentorUpdateSchema = z
  .object({
    name: personName,
    dept: z.string().trim().max(60).nullable(),
    designation: z.string().trim().max(50).nullable(),
    email,
    phone: phone.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const activityUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    capacity: z.coerce.number().int().min(1, "Capacity must be at least 1").max(500, "Capacity cannot exceed 500"),
    description: z.string().trim().max(255).nullable(),
    mentorId: id.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const groupUpdateSchema = z.object({
  name: z.string().trim().min(2).max(20).regex(/^[\p{L} ]+$/u, "Group name may contain only letters"),
});

export const scheduleUpdateSchema = z
  .object({
    room: z.string().trim().max(20).nullable().optional(),
    startTime: time.optional(),
    endTime: time.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")
  .refine((v) => !v.startTime || !v.endTime || v.endTime > v.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

export const generateRotationSchema = z
  .object({ startTime: time, endTime: time })
  .refine((v) => v.endTime > v.startTime, { message: "End time must be after start time", path: ["endTime"] });

export const attendanceActionSchema = z
  .object({
    studentId: id,
    activityId: id,
    action: z.enum(["check_in", "check_out", "set_check_in", "excuse", "mark_absent"]),
    time: time.optional(),
  })
  .refine((v) => v.action !== "set_check_in" || !!v.time, {
    message: "A time is required to set the check-in",
    path: ["time"],
  });

export const feedbackSubmitSchema = z.object({
  activityId: id,
  rating: z.coerce.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5"),
  comments: z.string().trim().max(1000).optional(),
});

export const feedbackSearchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  mode: z.enum(["natural", "boolean"]).default("natural"),
  activityId: id.optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  maxRating: z.coerce.number().int().min(1).max(5).optional(),
});

export const auditQuery = z.object({
  q: z.string().trim().max(80).optional(),
  activityId: id.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const studentRef = z.object({ studentId: id.optional() });

export const connectSchema = z.object({ peerId: id });

export const interestsSchema = z.object({
  activityIds: z.array(id).max(10).transform((ids) => [...new Set(ids)]),
});

export const pathQuery = z.object({ from: id, to: id }).refine((v) => v.from !== v.to, {
  message: "Pick two different students",
  path: ["to"],
});

export const recommendationQuery = z.object({
  studentId: id.optional(),
  prefer: z.enum(["cross-branch", "same-branch", "any"]).default("cross-branch"),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});
