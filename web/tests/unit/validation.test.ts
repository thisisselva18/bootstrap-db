import { describe, expect, it } from "vitest";
import {
  attendanceActionSchema,
  feedbackSubmitSchema,
  generateRotationSchema,
  interestsSchema,
  loginSchema,
  mentorCreateSchema,
  passwordChangeSchema,
  pathQuery,
  scheduleUpdateSchema,
  studentCreateSchema,
  studentUpdateSchema,
} from "@/lib/validation";

const validStudent = {
  usn: "1bm26cs099",
  name: "Test Student",
  email: "Test.Student@Univ.edu",
  branch: "Computer Science",
  semester: "3",
  groupId: "2",
  password: "Welcome123",
};

describe("studentCreateSchema", () => {
  it("normalises USN, email and numbers", () => {
    const s = studentCreateSchema.parse(validStudent);
    expect(s.usn).toBe("1BM26CS099");
    expect(s.email).toBe("test.student@univ.edu");
    expect(s.semester).toBe(3);
    expect(s.groupId).toBe(2);
  });

  it.each([
    ["semester 9", { semester: 9 }],
    ["semester 0", { semester: 0 }],
    ["bad USN", { usn: "AB-12" }],
    ["bad email", { email: "not-an-email" }],
    ["name with digits", { name: "R2D2" }],
    ["weak password", { password: "short" }],
    ["password without digit", { password: "onlyletters" }],
  ])("rejects %s", (_label, patch) => {
    expect(studentCreateSchema.safeParse({ ...validStudent, ...patch }).success).toBe(false);
  });
});

describe("studentUpdateSchema", () => {
  it("requires at least one field", () => {
    expect(studentUpdateSchema.safeParse({}).success).toBe(false);
    expect(studentUpdateSchema.safeParse({ semester: 4 }).success).toBe(true);
  });
});

describe("feedbackSubmitSchema", () => {
  it("accepts ratings 1..5 only", () => {
    expect(feedbackSubmitSchema.safeParse({ activityId: 1, rating: 5 }).success).toBe(true);
    expect(feedbackSubmitSchema.safeParse({ activityId: 1, rating: 0 }).success).toBe(false);
    expect(feedbackSubmitSchema.safeParse({ activityId: 1, rating: 6 }).success).toBe(false);
    expect(feedbackSubmitSchema.safeParse({ activityId: 1, rating: 3.5 }).success).toBe(false);
  });

  it("limits comments to 1000 characters", () => {
    expect(feedbackSubmitSchema.safeParse({ activityId: 1, rating: 4, comments: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("attendanceActionSchema", () => {
  it("needs a time for set_check_in and pads HH:MM", () => {
    expect(attendanceActionSchema.safeParse({ studentId: 1, activityId: 1, action: "set_check_in" }).success).toBe(false);
    const ok = attendanceActionSchema.parse({ studentId: 1, activityId: 1, action: "set_check_in", time: "09:20" });
    expect(ok.time).toBe("09:20:00");
  });

  it("rejects unknown actions and impossible times", () => {
    expect(attendanceActionSchema.safeParse({ studentId: 1, activityId: 1, action: "delete" }).success).toBe(false);
    expect(attendanceActionSchema.safeParse({ studentId: 1, activityId: 1, action: "set_check_in", time: "25:00" }).success).toBe(false);
  });
});

describe("schedule schemas", () => {
  it("requires end after start", () => {
    expect(scheduleUpdateSchema.safeParse({ startTime: "10:00", endTime: "09:00" }).success).toBe(false);
    expect(generateRotationSchema.safeParse({ startTime: "09:00", endTime: "16:30" }).success).toBe(true);
    expect(generateRotationSchema.safeParse({ startTime: "16:30", endTime: "09:00" }).success).toBe(false);
  });
});

describe("auth schemas", () => {
  it("validates login input", () => {
    expect(loginSchema.safeParse({ email: "admin@univ.edu", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "admin", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "admin@univ.edu", password: "" }).success).toBe(false);
  });

  it("rejects reusing the current password", () => {
    expect(passwordChangeSchema.safeParse({ currentPassword: "Secret123", newPassword: "Secret123" }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ currentPassword: "Secret123", newPassword: "Secret456" }).success).toBe(true);
  });
});

describe("mentor and graph schemas", () => {
  it("checks mentor phone format", () => {
    const base = { name: "New Mentor", email: "new.mentor@univ.edu" };
    expect(mentorCreateSchema.safeParse({ ...base, phone: "9845010099" }).success).toBe(true);
    expect(mentorCreateSchema.safeParse({ ...base, phone: "12345" }).success).toBe(false);
  });

  it("de-duplicates interests and refuses self paths", () => {
    expect(interestsSchema.parse({ activityIds: [3, 3, 5] }).activityIds).toEqual([3, 5]);
    expect(pathQuery.safeParse({ from: 4, to: 4 }).success).toBe(false);
  });
});
