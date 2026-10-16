import { boolean, date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const colleges = pgTable("colleges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  collegeId: integer("college_id")
    .notNull()
    .references(() => colleges.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  rollNumber: text("roll_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => ({
  uniqueRollPerCollege: uniqueIndex("students_college_roll_unique").on(table.collegeId, table.rollNumber),
}));

export const attendanceSessions = pgTable("attendance_sessions", {
  id: serial("id").primaryKey(),
  collegeId: integer("college_id")
    .notNull()
    .references(() => colleges.id, { onDelete: "cascade" }),
  sessionDate: date("session_date", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => ({
  uniqueCollegeDate: uniqueIndex("attendance_sessions_college_date_unique").on(table.collegeId, table.sessionDate),
}));

export const attendanceEntries = pgTable("attendance_entries", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => attendanceSessions.id, { onDelete: "cascade" }),
  studentId: integer("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  present: boolean("present").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => ({
  uniqueSessionStudent: uniqueIndex("attendance_entries_session_student_unique").on(table.sessionId, table.studentId),
}));
