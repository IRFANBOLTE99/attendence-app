import { db } from "@/db";
import { attendanceEntries, attendanceSessions, colleges, students } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchParams = {
  collegeId?: string;
  date?: string;
  theme?: string;
};

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

async function createCollege(formData: FormData) {
  "use server";

  const name = formData.get("name")?.toString().trim();
  if (!name) return;

  await db.insert(colleges).values({ name });
  revalidatePath("/");
}

async function createStudent(formData: FormData) {
  "use server";

  const fullName = formData.get("fullName")?.toString().trim();
  const rollNumber = formData.get("rollNumber")?.toString().trim();
  const collegeIdValue = Number(formData.get("collegeId"));

  if (!fullName || !rollNumber || !Number.isInteger(collegeIdValue) || collegeIdValue <= 0) {
    return;
  }

  await db
    .insert(students)
    .values({
      fullName,
      rollNumber,
      collegeId: collegeIdValue,
    })
    .onConflictDoNothing();

  revalidatePath("/");
}

async function saveAttendance(formData: FormData) {
  "use server";

  const collegeIdValue = Number(formData.get("collegeId"));
  const sessionDate = formData.get("sessionDate")?.toString() ?? "";
  const theme = formData.get("theme")?.toString() === "black" ? "black" : "light";

  if (!Number.isInteger(collegeIdValue) || collegeIdValue <= 0 || !isValidDate(sessionDate)) {
    return;
  }

  const presentStudentIds = new Set(
    formData
      .getAll("presentStudentIds")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  const collegeStudents = await db
    .select({ id: students.id })
    .from(students)
    .where(eq(students.collegeId, collegeIdValue));

  const [session] = await db
    .insert(attendanceSessions)
    .values({
      collegeId: collegeIdValue,
      sessionDate,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [attendanceSessions.collegeId, attendanceSessions.sessionDate],
      set: { updatedAt: new Date() },
    })
    .returning({ id: attendanceSessions.id });

  if (!session) {
    revalidatePath("/");
    return;
  }

  if (collegeStudents.length > 0) {
    await db
      .insert(attendanceEntries)
      .values(
        collegeStudents.map((student) => ({
          sessionId: session.id,
          studentId: student.id,
          present: presentStudentIds.has(student.id),
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [attendanceEntries.sessionId, attendanceEntries.studentId],
        set: {
          present: sql`excluded.present`,
          updatedAt: new Date(),
        },
      });
  }

  revalidatePath("/");
  redirect(`/?collegeId=${collegeIdValue}&date=${sessionDate}&theme=${theme}`);
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const theme = resolvedParams.theme === "black" ? "black" : "light";
  const isBlackTheme = theme === "black";

  const allColleges = await db.select().from(colleges).orderBy(colleges.name);
  const availableCollegeIds = new Set(allColleges.map((college) => college.id));

  const queryCollegeId = Number(resolvedParams.collegeId);
  const selectedCollegeId =
    Number.isInteger(queryCollegeId) && queryCollegeId > 0 && availableCollegeIds.has(queryCollegeId)
      ? queryCollegeId
      : (allColleges[0]?.id ?? null);

  const selectedDate =
    resolvedParams.date && isValidDate(resolvedParams.date) ? resolvedParams.date : getToday();

  const allStudents = selectedCollegeId
    ? await db
        .select({
          id: students.id,
          fullName: students.fullName,
          rollNumber: students.rollNumber,
        })
        .from(students)
        .where(eq(students.collegeId, selectedCollegeId))
        .orderBy(students.fullName)
    : [];

  const attendanceForDate = selectedCollegeId
    ? await db
        .select({
          studentId: students.id,
          present: attendanceEntries.present,
        })
        .from(students)
        .leftJoin(
          attendanceSessions,
          and(
            eq(attendanceSessions.collegeId, selectedCollegeId),
            eq(attendanceSessions.sessionDate, selectedDate),
          ),
        )
        .leftJoin(
          attendanceEntries,
          and(eq(attendanceEntries.sessionId, attendanceSessions.id), eq(attendanceEntries.studentId, students.id)),
        )
        .where(eq(students.collegeId, selectedCollegeId))
    : [];

  const attendanceMap = new Map<number, boolean>(
    attendanceForDate.map((row) => [row.studentId, row.present ?? false]),
  );

  const totalStudents = allStudents.length;
  const presentStudents = allStudents.filter((student) => attendanceMap.get(student.id)).length;
  const attendanceRate = totalStudents > 0 ? Math.round((presentStudents / totalStudents) * 100) : 0;

  const recentSessions = await db
    .select({
      id: attendanceSessions.id,
      sessionDate: attendanceSessions.sessionDate,
      collegeName: colleges.name,
      presentCount: sql<number>`coalesce(sum(case when ${attendanceEntries.present} then 1 else 0 end), 0)`,
      totalCount: sql<number>`count(${attendanceEntries.id})`,
    })
    .from(attendanceSessions)
    .innerJoin(colleges, eq(colleges.id, attendanceSessions.collegeId))
    .leftJoin(attendanceEntries, eq(attendanceEntries.sessionId, attendanceSessions.id))
    .groupBy(attendanceSessions.id, colleges.name)
    .orderBy(desc(attendanceSessions.sessionDate), desc(attendanceSessions.id))
    .limit(7);

  const leaderboard = selectedCollegeId
    ? await db
        .select({
          id: students.id,
          fullName: students.fullName,
          rollNumber: students.rollNumber,
          presentCount: sql<number>`coalesce(sum(case when ${attendanceEntries.present} then 1 else 0 end), 0)`,
          totalMarked: sql<number>`count(${attendanceEntries.id})`,
        })
        .from(students)
        .leftJoin(attendanceEntries, eq(attendanceEntries.studentId, students.id))
        .leftJoin(
          attendanceSessions,
          and(eq(attendanceSessions.id, attendanceEntries.sessionId), eq(attendanceSessions.collegeId, selectedCollegeId)),
        )
        .where(eq(students.collegeId, selectedCollegeId))
        .groupBy(students.id, students.fullName, students.rollNumber)
        .orderBy(
          desc(sql`coalesce(sum(case when ${attendanceEntries.present} then 1 else 0 end), 0)`),
          desc(sql`count(${attendanceEntries.id})`),
          students.fullName,
        )
        .limit(8)
    : [];

  const getThemeHref = (nextTheme: "light" | "black") => {
    const params = new URLSearchParams();
    if (selectedCollegeId) params.set("collegeId", String(selectedCollegeId));
    params.set("date", selectedDate);
    params.set("theme", nextTheme);
    return `/?${params.toString()}`;
  };

  const textStrong = isBlackTheme ? "text-white" : "text-slate-900";
  const textSoft = isBlackTheme ? "text-slate-300" : "text-slate-600";
  const textMute = isBlackTheme ? "text-slate-400" : "text-slate-500";
  const rowClass = isBlackTheme
    ? "rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10"
    : "rounded-2xl bg-white/75 px-4 py-3 ring-1 ring-slate-200/70";

  return (
    <main className={`aurora-bg min-h-screen px-4 py-8 md:px-8 ${isBlackTheme ? "theme-black" : ""}`}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="apple-card p-6 md:p-10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={`text-xs font-medium tracking-[0.24em] uppercase ${textMute}`}>ATTENDANCE APP</p>
              <h1 className={`mt-3 text-3xl font-semibold tracking-tight md:text-5xl ${textStrong}`}>
                Youth Campus Attendance App
              </h1>
              <p className={`mt-3 max-w-2xl text-sm md:text-base ${textSoft}`}>
                Streamlined for colleges: add students, mark daily attendance, and track performance with a clean premium UI.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <a className={`theme-chip ${theme === "light" ? "theme-chip-active" : ""}`} href={getThemeHref("light")}>
                Light
              </a>
              <a className={`theme-chip ${theme === "black" ? "theme-chip-active" : ""}`} href={getThemeHref("black")}>
                Black
              </a>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="apple-card p-5">
            <p className={`text-xs tracking-wide uppercase ${textMute}`}>Students</p>
            <p className={`mt-2 text-3xl font-semibold ${textStrong}`}>{totalStudents}</p>
          </article>
          <article className="apple-card p-5">
            <p className={`text-xs tracking-wide uppercase ${textMute}`}>Present Today</p>
            <p className={`mt-2 text-3xl font-semibold ${textStrong}`}>{presentStudents}</p>
          </article>
          <article className="apple-card p-5">
            <p className={`text-xs tracking-wide uppercase ${textMute}`}>Attendance Rate</p>
            <p className={`mt-2 text-3xl font-semibold ${textStrong}`}>{attendanceRate}%</p>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="apple-card p-6">
            <h2 className={`text-xl font-semibold ${textStrong}`}>Mark Attendance</h2>

            <form className="mt-5 grid gap-3 rounded-2xl bg-white/70 p-4 theme-panel" method="get">
              <input type="hidden" name="theme" value={theme} />
              <label className={`text-xs font-medium tracking-wide uppercase ${textMute}`}>Select College</label>
              <select name="collegeId" defaultValue={selectedCollegeId ?? ""} className="input-apple" required>
                {allColleges.length === 0 ? (
                  <option value="">No colleges yet</option>
                ) : (
                  allColleges.map((college) => (
                    <option key={college.id} value={college.id}>
                      {college.name}
                    </option>
                  ))
                )}
              </select>

              <label className={`mt-2 text-xs font-medium tracking-wide uppercase ${textMute}`}>Session Date</label>
              <input name="date" type="date" defaultValue={selectedDate} className="input-apple" required />

              <button className="btn-apple mt-2" type="submit">
                Load Students
              </button>
            </form>

            {selectedCollegeId && allStudents.length > 0 ? (
              <form action={saveAttendance} className="mt-5 space-y-3">
                <input type="hidden" name="collegeId" value={selectedCollegeId} />
                <input type="hidden" name="sessionDate" value={selectedDate} />
                <input type="hidden" name="theme" value={theme} />

                <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                  {allStudents.map((student) => {
                    const checked = attendanceMap.get(student.id) ?? false;
                    return (
                      <label key={student.id} className={`flex items-center justify-between ${rowClass}`}>
                        <span>
                          <span className={`block font-medium ${textStrong}`}>{student.fullName}</span>
                          <span className={`text-xs ${textMute}`}>Roll: {student.rollNumber}</span>
                        </span>
                        <input
                          className="h-5 w-5 accent-slate-900"
                          name="presentStudentIds"
                          type="checkbox"
                          value={student.id}
                          defaultChecked={checked}
                        />
                      </label>
                    );
                  })}
                </div>

                <button className="btn-apple w-full" type="submit">
                  Save Attendance
                </button>
              </form>
            ) : (
              <p className={`mt-5 rounded-2xl p-4 text-sm ring-1 theme-panel ${textSoft}`}>
                {allColleges.length === 0
                  ? "Add your first college to start tracking attendance."
                  : "Add students to this college before marking attendance."}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <div className="apple-card p-6">
              <h3 className={`text-lg font-semibold ${textStrong}`}>Add College</h3>
              <form action={createCollege} className="mt-4 space-y-3">
                <input
                  className="input-apple"
                  name="name"
                  placeholder="e.g. Horizon Commerce College"
                  required
                  type="text"
                />
                <button className="btn-apple w-full" type="submit">
                  Create College
                </button>
              </form>
            </div>

            <div className="apple-card p-6">
              <h3 className={`text-lg font-semibold ${textStrong}`}>Add Student</h3>
              <form action={createStudent} className="mt-4 space-y-3">
                <select className="input-apple" name="collegeId" required defaultValue={selectedCollegeId ?? ""}>
                  <option value="" disabled>
                    Select college
                  </option>
                  {allColleges.map((college) => (
                    <option key={college.id} value={college.id}>
                      {college.name}
                    </option>
                  ))}
                </select>
                <input className="input-apple" name="fullName" placeholder="Full name" required type="text" />
                <input className="input-apple" name="rollNumber" placeholder="Roll number" required type="text" />
                <button className="btn-apple w-full" type="submit">
                  Add Student
                </button>
              </form>
            </div>

            <div className="apple-card p-6">
              <h3 className={`text-lg font-semibold ${textStrong}`}>Leaderboard</h3>
              <div className="mt-4 space-y-2">
                {leaderboard.length === 0 ? (
                  <p className={`rounded-xl p-3 text-sm ring-1 theme-panel ${textSoft}`}>No students yet.</p>
                ) : (
                  leaderboard.map((student, index) => {
                    const present = Number(student.presentCount) || 0;
                    const total = Number(student.totalMarked) || 0;
                    const percent = total > 0 ? Math.round((present / total) * 100) : 0;

                    return (
                      <article key={student.id} className={rowClass}>
                        <p className={`font-medium ${textStrong}`}>
                          #{index + 1} {student.fullName}
                        </p>
                        <p className={`text-xs ${textMute}`}>Roll: {student.rollNumber}</p>
                        <p className={`mt-1 text-sm ${textSoft}`}>
                          {present}/{total} present ({percent}%)
                        </p>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="apple-card p-6">
              <h3 className={`text-lg font-semibold ${textStrong}`}>Recent Sessions</h3>
              <div className="mt-4 space-y-2">
                {recentSessions.length === 0 ? (
                  <p className={`rounded-xl p-3 text-sm ring-1 theme-panel ${textSoft}`}>No attendance sessions yet.</p>
                ) : (
                  recentSessions.map((session) => {
                    const present = Number(session.presentCount) || 0;
                    const total = Number(session.totalCount) || 0;
                    const percent = total > 0 ? Math.round((present / total) * 100) : 0;

                    return (
                      <article key={session.id} className={rowClass}>
                        <p className={`font-medium ${textStrong}`}>{session.collegeName}</p>
                        <p className={`text-xs ${textMute}`}>{session.sessionDate}</p>
                        <p className={`mt-1 text-sm ${textSoft}`}>
                          {present}/{total} present ({percent}%)
                        </p>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
