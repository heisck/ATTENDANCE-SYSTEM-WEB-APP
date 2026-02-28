const {
  PrismaClient,
  Role,
  SubscriptionPlan,
  NotificationType,
  TimetableMode,
  ClassUpdateType,
  MaterialStatus,
  GroupFormationMode,
  GroupLeaderMode,
  AttendancePhase,
  SessionStatus,
  ReverifyStatus,
  JobType,
  JobStatus,
} = require("@prisma/client");
const { hashSync } = require("bcryptjs");
const { randomUUID } = require("crypto");

const prisma = new PrismaClient();

const ORG = {
  name: "Kwame Nkrumah University of Science and Technology",
  slug: "knust",
  domain: "knust.edu.gh",
};

const PROGRAMS = [
  {
    code: "CS",
    name: "BSc Computer Science",
    aliases: ["BSc Computer Science", "BSc.Computer Science", "bsc computer science", "BSc-ComputerScience"],
    groupCodes: ["G1", "G2"],
    maxLevel: 400,
  },
  {
    code: "IT",
    name: "BSc Information Technology",
    aliases: [
      "BSc Information Technology",
      "BSc.IT",
      "bsc information technology",
      "BSc-InformationTechnology",
    ],
    groupCodes: ["G1", "G2"],
    maxLevel: 400,
  },
  {
    code: "SE",
    name: "BSc Software Engineering",
    aliases: [
      "BSc Software Engineering",
      "BSc.Software Engineering",
      "bsc software engineering",
      "BSc-SoftwareEngineering",
    ],
    groupCodes: ["G1"],
    maxLevel: 400,
  },
];

const LEVELS = [100, 200, 300, 400];
const STUDENTS_PER_COHORT = 4;

const COURSE_BLUEPRINT = {
  CS: {
    100: [
      { code: "CS101", name: "Programming Fundamentals" },
      { code: "CS102", name: "Discrete Mathematics" },
    ],
    200: [
      { code: "CS201", name: "Data Structures" },
      { code: "CS202", name: "Computer Architecture" },
    ],
    300: [
      { code: "CS301", name: "Operating Systems" },
      { code: "CS302", name: "Database Systems" },
    ],
    400: [
      { code: "CS401", name: "Machine Learning" },
      { code: "CS402", name: "Distributed Systems" },
    ],
  },
  IT: {
    100: [
      { code: "IT101", name: "Foundations of Information Technology" },
      { code: "IT102", name: "Digital Literacy and Systems" },
    ],
    200: [
      { code: "IT201", name: "Web Technologies" },
      { code: "IT202", name: "Networking Essentials" },
    ],
    300: [
      { code: "IT301", name: "Cloud Infrastructure" },
      { code: "IT302", name: "Information Security" },
    ],
    400: [
      { code: "IT401", name: "Enterprise Systems Integration" },
      { code: "IT402", name: "IT Project Management" },
    ],
  },
  SE: {
    100: [
      { code: "SE101", name: "Introduction to Software Engineering" },
      { code: "SE102", name: "Programming Studio" },
    ],
    200: [
      { code: "SE201", name: "Object-Oriented Design" },
      { code: "SE202", name: "Requirements Engineering" },
    ],
    300: [
      { code: "SE301", name: "Software Testing and QA" },
      { code: "SE302", name: "Software Architecture" },
    ],
    400: [
      { code: "SE401", name: "DevOps and Release Engineering" },
      { code: "SE402", name: "Capstone Project" },
    ],
  },
};

const CORE_COURSES = {
  100: { code: "GST101", name: "Communication Skills I" },
  200: { code: "GST201", name: "Critical Thinking and Ethics" },
  300: { code: "GST301", name: "Research Methods" },
  400: { code: "GST401", name: "Innovation and Entrepreneurship" },
};

const LECTURERS = [
  {
    email: "lecturer.cs1@knust.edu.gh",
    name: "Dr. Kwame Asante",
    department: "CS",
    office: "CS Block A2",
    whatsapp: "+233241000001",
  },
  {
    email: "lecturer.cs2@knust.edu.gh",
    name: "Dr. Nana Yeboah",
    department: "CS",
    office: "CS Block B4",
    whatsapp: "+233241000002",
  },
  {
    email: "lecturer.cs3@knust.edu.gh",
    name: "Dr. Adwoa Mensah",
    department: "CS",
    office: "CS Block C1",
    whatsapp: "+233241000003",
  },
  {
    email: "lecturer.it1@knust.edu.gh",
    name: "Mr. Kofi Bediako",
    department: "IT",
    office: "IT Annex 2",
    whatsapp: "+233241000011",
  },
  {
    email: "lecturer.it2@knust.edu.gh",
    name: "Mrs. Efua Boateng",
    department: "IT",
    office: "IT Annex 5",
    whatsapp: "+233241000012",
  },
  {
    email: "lecturer.it3@knust.edu.gh",
    name: "Mr. Daniel Ofori",
    department: "IT",
    office: "IT Annex 1",
    whatsapp: "+233241000013",
  },
  {
    email: "lecturer.se1@knust.edu.gh",
    name: "Dr. Linda Agyeman",
    department: "SE",
    office: "SE Studio 3",
    whatsapp: "+233241000021",
  },
  {
    email: "lecturer.se2@knust.edu.gh",
    name: "Mr. Michael Tetteh",
    department: "SE",
    office: "SE Studio 1",
    whatsapp: "+233241000022",
  },
  {
    email: "lecturer.se3@knust.edu.gh",
    name: "Mrs. Akosua Ntim",
    department: "SE",
    office: "SE Studio 4",
    whatsapp: "+233241000023",
  },
];

function cohortKey(department, level, groupCode) {
  return `${department}-${level}-${groupCode}`;
}

function addDays(base, days) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function addHours(base, hours) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(base, minutes) {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

function makeProgramSettings(now) {
  return {
    campusLat: 6.6745,
    campusLng: -1.5716,
    defaultRadiusMeters: 350,
    confidenceThreshold: 72,
    studentEmailDomains: ["st.knust.edu.gh", "knust.edu.gh"],
    timezone: "Africa/Accra",
    featureFlags: {
      studentHubCore: true,
      courseRepTools: true,
      examHub: true,
      groupFormation: true,
    },
    academicCalendar: {
      currentSemester: 1,
      examMode: false,
      cycleYear: now.getFullYear(),
    },
    academicProgression: {
      maxLevel: 400,
      archiveGraduates: false,
    },
    studentHubBilling: {
      trialStartsAt: addDays(now, -7).toISOString(),
      trialEndsAt: addDays(now, 21).toISOString(),
      paymentRequired: true,
      paymentAmount: 5,
      paymentCurrency: "GHS",
      paymentActive: false,
      lockAfterTrial: true,
    },
    programCatalog: PROGRAMS.map((program) => ({
      code: program.code,
      name: program.name,
      aliases: program.aliases,
      maxLevel: program.maxLevel,
      defaultGroupCode: "G1",
    })),
    programNormalization: {
      enabled: true,
      stripDots: true,
      stripSpecialCharacters: true,
      trimExtraSpaces: true,
      toUpperCase: true,
    },
    lecturerDirectory: LECTURERS.map((lecturer) => ({
      name: lecturer.name,
      department: lecturer.department,
      office: lecturer.office,
      whatsapp: lecturer.whatsapp,
    })),
  };
}

async function seedOrganization() {
  const now = new Date();
  const passwordHash = hashSync("password123", 10);
  const orgSettings = makeProgramSettings(now);

  const org = await prisma.organization.upsert({
    where: { slug: ORG.slug },
    update: {
      name: ORG.name,
      domain: ORG.domain,
      settings: orgSettings,
    },
    create: {
      name: ORG.name,
      slug: ORG.slug,
      domain: ORG.domain,
      settings: orgSettings,
    },
  });
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: {
      plan: SubscriptionPlan.PRO,
      maxStudents: 12000,
      maxCourses: 1200,
    },
    create: {
      organizationId: org.id,
      plan: SubscriptionPlan.PRO,
      maxStudents: 12000,
      maxCourses: 1200,
    },
  });

  await prisma.trustedIpRange.deleteMany({ where: { organizationId: org.id } });
  await prisma.trustedIpRange.createMany({
    data: [
      { organizationId: org.id, cidr: "41.66.0.0/16", label: "KNUST Campus WiFi" },
      { organizationId: org.id, cidr: "196.44.0.0/16", label: "KNUST ISP Backbone" },
    ],
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@attendanceiq.com" },
    update: {
      name: "Platform Admin",
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
    create: {
      email: "superadmin@attendanceiq.com",
      name: "Platform Admin",
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@knust.edu.gh" },
    update: {
      name: "KNUST Admin",
      passwordHash,
      role: Role.ADMIN,
      organizationId: org.id,
      emailVerified: now,
    },
    create: {
      email: "admin@knust.edu.gh",
      name: "KNUST Admin",
      passwordHash,
      role: Role.ADMIN,
      organizationId: org.id,
      emailVerified: now,
    },
  });

  await prisma.user.upsert({
    where: { email: "deputy.admin@knust.edu.gh" },
    update: {
      name: "Deputy Academic Admin",
      passwordHash,
      role: Role.ADMIN,
      organizationId: org.id,
      emailVerified: now,
    },
    create: {
      email: "deputy.admin@knust.edu.gh",
      name: "Deputy Academic Admin",
      passwordHash,
      role: Role.ADMIN,
      organizationId: org.id,
      emailVerified: now,
    },
  });

  const lecturerUsers = [];
  const lecturersByDepartment = new Map();
  for (const lecturer of LECTURERS) {
    const user = await prisma.user.upsert({
      where: { email: lecturer.email },
      update: {
        name: lecturer.name,
        passwordHash,
        role: Role.LECTURER,
        organizationId: org.id,
        emailVerified: now,
      },
      create: {
        email: lecturer.email,
        name: lecturer.name,
        passwordHash,
        role: Role.LECTURER,
        organizationId: org.id,
        emailVerified: now,
      },
    });
    lecturerUsers.push(user);
    const existing = lecturersByDepartment.get(lecturer.department) || [];
    existing.push(user);
    lecturersByDepartment.set(lecturer.department, existing);
  }

  const cohorts = [];
  const cohortByKey = new Map();
  for (const program of PROGRAMS) {
    for (const level of LEVELS) {
      for (const groupCode of program.groupCodes) {
        const key = cohortKey(program.code, level, groupCode);
        const displayName = `${program.name} - Level ${level} - ${groupCode}`;
        const cohort = await prisma.cohort.upsert({
          where: {
            organizationId_department_level_groupCode: {
              organizationId: org.id,
              department: program.code,
              level,
              groupCode,
            },
          },
          update: { displayName },
          create: {
            organizationId: org.id,
            department: program.code,
            level,
            groupCode,
            displayName,
          },
        });
        cohorts.push(cohort);
        cohortByKey.set(key, { ...cohort, programName: program.name, maxLevel: program.maxLevel });
      }
    }
  }

  let serialCounter = 1;
  const studentsByCohort = new Map();
  const allStudents = [];

  for (const cohort of cohorts) {
    const key = cohortKey(cohort.department, cohort.level, cohort.groupCode);
    const students = [];
    for (let i = 1; i <= STUDENTS_PER_COHORT; i += 1) {
      const serial = String(serialCounter).padStart(4, "0");
      const emailPrefix = `${cohort.department.toLowerCase()}${cohort.level}${cohort.groupCode.toLowerCase()}s${i}`;
      const user = await prisma.user.upsert({
        where: { email: `${emailPrefix}@st.knust.edu.gh` },
        update: {
          name: `Student ${cohort.department}${cohort.level}${cohort.groupCode}-${i}`,
          passwordHash,
          role: Role.STUDENT,
          studentId: `2026${serial}`,
          indexNumber: `IDX/${cohort.department}/${cohort.level}/${serial}`,
          personalEmail: `${emailPrefix}.personal@gmail.com`,
          organizationId: org.id,
          cohortId: cohort.id,
          emailVerified: now,
          personalEmailVerifiedAt: now,
          passkeysLockedUntilAdminReset: i === 4 && cohort.level >= 300,
        },
        create: {
          email: `${emailPrefix}@st.knust.edu.gh`,
          name: `Student ${cohort.department}${cohort.level}${cohort.groupCode}-${i}`,
          passwordHash,
          role: Role.STUDENT,
          studentId: `2026${serial}`,
          indexNumber: `IDX/${cohort.department}/${cohort.level}/${serial}`,
          personalEmail: `${emailPrefix}.personal@gmail.com`,
          organizationId: org.id,
          cohortId: cohort.id,
          emailVerified: now,
          personalEmailVerifiedAt: now,
          passkeysLockedUntilAdminReset: i === 4 && cohort.level >= 300,
        },
      });
      students.push(user);
      allStudents.push({ ...user, cohortKey: key, department: cohort.department, level: cohort.level });
      serialCounter += 1;
    }
    studentsByCohort.set(key, students);
  }

  const allCourses = [];
  const coursesByDeptLevel = new Map();

  for (const department of Object.keys(COURSE_BLUEPRINT)) {
    const deptBlueprint = COURSE_BLUEPRINT[department];
    for (const level of LEVELS) {
      const courseDefs = deptBlueprint[level] || [];
      const deptLecturers = lecturersByDepartment.get(department) || lecturerUsers;
      const courseList = [];
      for (let i = 0; i < courseDefs.length; i += 1) {
        const def = courseDefs[i];
        const lecturer = deptLecturers[i % deptLecturers.length] || lecturerUsers[0];
        const course = await prisma.course.upsert({
          where: {
            code_organizationId: {
              code: def.code,
              organizationId: org.id,
            },
          },
          update: {
            name: def.name,
            description: `${def.name} for ${department} level ${level}`,
            lecturerId: lecturer.id,
          },
          create: {
            code: def.code,
            name: def.name,
            description: `${def.name} for ${department} level ${level}`,
            organizationId: org.id,
            lecturerId: lecturer.id,
          },
        });
        courseList.push(course);
        allCourses.push({ ...course, department, level, isCore: false });
      }
      coursesByDeptLevel.set(`${department}-${level}`, courseList);
    }
  }

  const coreCourseByLevel = new Map();
  for (const level of LEVELS) {
    const core = CORE_COURSES[level];
    const lecturer = lecturerUsers[level % lecturerUsers.length] || lecturerUsers[0];
    const course = await prisma.course.upsert({
      where: {
        code_organizationId: {
          code: core.code,
          organizationId: org.id,
        },
      },
      update: {
        name: core.name,
        description: `${core.name} (common university requirement)`,
        lecturerId: lecturer.id,
      },
      create: {
        code: core.code,
        name: core.name,
        description: `${core.name} (common university requirement)`,
        organizationId: org.id,
        lecturerId: lecturer.id,
      },
    });
    coreCourseByLevel.set(level, course);
    allCourses.push({ ...course, department: "CORE", level, isCore: true });
  }
  await prisma.enrollment.deleteMany({
    where: { course: { organizationId: org.id } },
  });

  for (const [key, students] of studentsByCohort.entries()) {
    const [department, levelText] = key.split("-");
    const level = Number(levelText);
    const deptCourses = coursesByDeptLevel.get(`${department}-${level}`) || [];
    const coreCourse = coreCourseByLevel.get(level);
    const finalCourses = [...deptCourses, coreCourse].filter(Boolean);
    for (const student of students) {
      for (const course of finalCourses) {
        await prisma.enrollment.create({
          data: {
            courseId: course.id,
            studentId: student.id,
          },
        });
      }
    }
  }

  await prisma.courseRepScope.deleteMany({ where: { organizationId: org.id } });
  await prisma.courseRepInvite.deleteMany({ where: { organizationId: org.id } });

  const repByCohortKey = new Map();

  for (const [key, students] of studentsByCohort.entries()) {
    const [department, levelText, groupCode] = key.split("-");
    const level = Number(levelText);
    const cohort = cohortByKey.get(key);
    const rep = students[0];
    await prisma.courseRepScope.create({
      data: {
        userId: rep.id,
        organizationId: org.id,
        cohortId: cohort.id,
        courseId: null,
        active: true,
        assignedByUserId: admin.id,
      },
    });
    repByCohortKey.set(key, rep);

    const courseSpecificRep = students[1];
    const courseList = coursesByDeptLevel.get(`${department}-${level}`) || [];
    if (courseSpecificRep && courseList[0]) {
      await prisma.courseRepScope.create({
        data: {
          userId: courseSpecificRep.id,
          organizationId: org.id,
          cohortId: null,
          courseId: courseList[0].id,
          active: true,
          assignedByUserId: admin.id,
        },
      });
    }

    if (groupCode === "G1") {
      await prisma.courseRepInvite.create({
        data: {
          organizationId: org.id,
          invitedEmail: `${department.toLowerCase()}${level}${groupCode.toLowerCase()}rep.future@st.knust.edu.gh`,
          targetUserId: null,
          cohortId: cohort.id,
          courseId: null,
          tokenHash: `seed-invite-${department}-${level}-${groupCode}-${randomUUID()}`,
          expiresAt: addDays(now, 10),
          acceptedAt: null,
          revokedAt: null,
          invitedByUserId: admin.id,
        },
      });
    }
  }

  await prisma.timetableEntry.deleteMany({ where: { organizationId: org.id } });
  const daySlots = [
    { dayOfWeek: 1, startTime: "08:00", endTime: "10:00", mode: TimetableMode.PHYSICAL },
    { dayOfWeek: 3, startTime: "10:30", endTime: "12:30", mode: TimetableMode.ONLINE },
    { dayOfWeek: 5, startTime: "14:00", endTime: "16:00", mode: TimetableMode.HYBRID },
  ];

  const timetableEntries = [];

  for (const [key, cohortInfo] of cohortByKey.entries()) {
    const [department, levelText] = key.split("-");
    const level = Number(levelText);
    const rep = repByCohortKey.get(key) || admin;
    const deptCourses = coursesByDeptLevel.get(`${department}-${level}`) || [];
    const coreCourse = coreCourseByLevel.get(level);
    const finalCourses = [...deptCourses, coreCourse].filter(Boolean);
    for (let i = 0; i < Math.min(3, finalCourses.length); i += 1) {
      const slot = daySlots[i % daySlots.length];
      const course = finalCourses[i];
      const entry = await prisma.timetableEntry.create({
        data: {
          organizationId: org.id,
          cohortId: cohortInfo.id,
          courseId: course.id,
          courseCode: course.code,
          courseTitle: course.name,
          lecturerName: lecturerUsers[i % lecturerUsers.length].name,
          taName: `TA ${department}-${level}-${i + 1}`,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          venue: slot.mode === TimetableMode.ONLINE ? "Virtual Classroom" : `${department} Hall ${i + 1}`,
          mode: slot.mode,
          onlineLink:
            slot.mode === TimetableMode.PHYSICAL
              ? null
              : `https://meet.attendanceiq.app/${course.code.toLowerCase()}-${key.toLowerCase()}`,
          notes:
            slot.mode === TimetableMode.HYBRID
              ? "Hybrid delivery: first half physical, second half online."
              : null,
          createdByUserId: rep.id,
          isActive: true,
        },
      });
      timetableEntries.push({ ...entry, cohortKey: key });
    }
  }

  await prisma.classUpdate.deleteMany({ where: { organizationId: org.id } });
  const classUpdateTypes = [
    ClassUpdateType.CANCELLED,
    ClassUpdateType.RESCHEDULED,
    ClassUpdateType.VENUE_CHANGE,
    ClassUpdateType.ONLINE_LINK,
    ClassUpdateType.TAKEOVER,
    ClassUpdateType.NOTICE,
  ];

  for (let i = 0; i < Math.min(24, timetableEntries.length); i += 1) {
    const entry = timetableEntries[i];
    const type = classUpdateTypes[i % classUpdateTypes.length];
    const rep = repByCohortKey.get(entry.cohortKey) || admin;
    let message = `${entry.courseCode} update has been published.`;
    let payload = {};
    if (type === ClassUpdateType.CANCELLED) {
      message = `${entry.courseCode} class is cancelled for this slot.`;
    } else if (type === ClassUpdateType.RESCHEDULED) {
      message = `${entry.courseCode} moved to Saturday 09:00.`;
      payload = { newDayOfWeek: 6, newStartTime: "09:00", newEndTime: "11:00" };
    } else if (type === ClassUpdateType.VENUE_CHANGE) {
      message = `${entry.courseCode} venue changed to Main Auditorium 2.`;
      payload = { previousVenue: entry.venue, newVenue: "Main Auditorium 2" };
    } else if (type === ClassUpdateType.ONLINE_LINK) {
      message = `${entry.courseCode} now runs online using updated link.`;
      payload = { link: `https://meet.attendanceiq.app/live/${entry.courseCode.toLowerCase()}` };
    } else if (type === ClassUpdateType.TAKEOVER) {
      message = `${entry.courseCode} will be handled by the teaching assistant this week.`;
      payload = { takeoverBy: entry.taName || "Assigned TA" };
    } else {
      message = `${entry.courseCode} reminder: bring your lab sheet for this class.`;
    }
    await prisma.classUpdate.create({
      data: {
        organizationId: org.id,
        cohortId: entry.cohortId,
        courseId: entry.courseId,
        type,
        title: `${entry.courseCode} ${type.replace("_", " ")}`,
        message,
        effectiveAt: addHours(now, i + 2),
        payload,
        createdByUserId: rep.id,
        isActive: true,
      },
    });
  }
  await prisma.assignmentAttachment.deleteMany({
    where: { announcement: { organizationId: org.id } },
  });
  await prisma.assignmentAnnouncement.deleteMany({ where: { organizationId: org.id } });

  let assignmentCounter = 1;
  for (const [key, cohortInfo] of Array.from(cohortByKey.entries()).slice(0, 18)) {
    const [department, levelText] = key.split("-");
    const level = Number(levelText);
    const rep = repByCohortKey.get(key) || admin;
    const courseList = coursesByDeptLevel.get(`${department}-${level}`) || [];
    if (courseList.length === 0) continue;
    for (let i = 0; i < Math.min(2, courseList.length); i += 1) {
      const course = courseList[i];
      const dueAt = addDays(now, 2 + ((assignmentCounter + i) % 8));
      const assignment = await prisma.assignmentAnnouncement.create({
        data: {
          organizationId: org.id,
          cohortId: cohortInfo.id,
          courseId: course.id,
          title: `${course.code} Assignment ${i + 1}`,
          body: `Solve the attached problem set for ${course.name}. Ensure your derivations are clearly documented.`,
          dueAt,
          submissionNote: "Submit on the official LMS portal before the deadline.",
          isGroupAssignment: i % 2 === 1,
          createdByUserId: rep.id,
        },
      });
      await prisma.assignmentAttachment.create({
        data: {
          announcementId: assignment.id,
          publicId: `seed/${org.slug}/assignments/${course.code.toLowerCase()}-${assignmentCounter}-${i + 1}`,
          resourceType: "raw",
          url: `https://res.cloudinary.com/demo/raw/upload/v1/seed/${org.slug}/assignments/${course.code.toLowerCase()}-${assignmentCounter}-${i + 1}.pdf`,
          fileName: `${course.code}-assignment-${i + 1}.pdf`,
          bytes: 180000 + assignmentCounter * 150,
          mime: "application/pdf",
        },
      });
    }
    assignmentCounter += 1;
  }

  await prisma.courseMaterial.deleteMany({ where: { organizationId: org.id } });
  await prisma.materialSection.deleteMany({ where: { organizationId: org.id } });

  const materialCourses = allCourses.filter((course) => !course.isCore).slice(0, 12);
  let materialCounter = 1;
  for (const course of materialCourses) {
    const key = cohortKey(course.department, course.level, "G1");
    const cohortInfo = cohortByKey.get(key);
    const rep = repByCohortKey.get(key) || admin;
    if (!cohortInfo) continue;

    const sectionA = await prisma.materialSection.create({
      data: {
        organizationId: org.id,
        courseId: course.id,
        cohortId: cohortInfo.id,
        title: "Week 1: Foundation",
        description: "Introductory lecture materials.",
        orderIndex: 1,
        createdByUserId: rep.id,
        isActive: true,
      },
    });
    const sectionB = await prisma.materialSection.create({
      data: {
        organizationId: org.id,
        courseId: course.id,
        cohortId: cohortInfo.id,
        title: "Week 2: Applied Concepts",
        description: "Applied examples and reading references.",
        orderIndex: 2,
        createdByUserId: rep.id,
        isActive: true,
      },
    });

    await prisma.courseMaterial.createMany({
      data: [
        {
          organizationId: org.id,
          courseId: course.id,
          cohortId: cohortInfo.id,
          sectionId: sectionA.id,
          title: `${course.code} Week 1 Slides`,
          description: "Lecture slide deck.",
          status: MaterialStatus.PUBLISHED,
          publicId: `seed/${org.slug}/materials/${course.code.toLowerCase()}-w1-${materialCounter}`,
          resourceType: "raw",
          url: `https://res.cloudinary.com/demo/raw/upload/v1/seed/${org.slug}/materials/${course.code.toLowerCase()}-w1-${materialCounter}.pdf`,
          fileName: `${course.code}-week-1-slides.pdf`,
          bytes: 245000,
          mime: "application/pdf",
          viewCount: 24 + materialCounter,
          downloadCount: 12 + materialCounter,
          createdByUserId: rep.id,
        },
        {
          organizationId: org.id,
          courseId: course.id,
          cohortId: cohortInfo.id,
          sectionId: sectionB.id,
          title: `${course.code} Week 2 Notes`,
          description: "Extended handout and reading list.",
          status: MaterialStatus.PUBLISHED,
          publicId: `seed/${org.slug}/materials/${course.code.toLowerCase()}-w2-${materialCounter}`,
          resourceType: "raw",
          url: `https://res.cloudinary.com/demo/raw/upload/v1/seed/${org.slug}/materials/${course.code.toLowerCase()}-w2-${materialCounter}.pdf`,
          fileName: `${course.code}-week-2-notes.pdf`,
          bytes: 198000,
          mime: "application/pdf",
          viewCount: 18 + materialCounter,
          downloadCount: 8 + materialCounter,
          createdByUserId: rep.id,
        },
      ],
    });
    materialCounter += 1;
  }

  await prisma.examAttachment.deleteMany({ where: { examEntry: { organizationId: org.id } } });
  await prisma.examUpdate.deleteMany({ where: { examEntry: { organizationId: org.id } } });
  await prisma.examEntry.deleteMany({ where: { organizationId: org.id } });

  let examCounter = 1;
  for (const [key, cohortInfo] of cohortByKey.entries()) {
    const [department, levelText] = key.split("-");
    const level = Number(levelText);
    const courseList = coursesByDeptLevel.get(`${department}-${level}`) || [];
    const rep = repByCohortKey.get(key) || admin;
    if (courseList.length === 0) continue;
    const course = courseList[0];
    const examDate = addDays(now, 9 + examCounter);
    const exam = await prisma.examEntry.create({
      data: {
        organizationId: org.id,
        cohortId: cohortInfo.id,
        courseId: course.id,
        title: `${course.code} End of Semester Examination`,
        examDate,
        endAt: addHours(examDate, 2),
        venue: `Exam Hall ${((examCounter - 1) % 6) + 1}`,
        allowAnyHall: examCounter % 4 === 0,
        instructions: "Bring institutional ID and approved writing materials.",
        createdByUserId: rep.id,
      },
    });

    if (examCounter % 2 === 0) {
      await prisma.examUpdate.create({
        data: {
          examEntryId: exam.id,
          updateType: "VENUE_UPDATE",
          message: `Venue confirmed for ${exam.title}.`,
          effectiveAt: addDays(examDate, -1),
          payload: { venue: `Exam Hall ${((examCounter + 2) % 6) + 1}` },
          createdByUserId: rep.id,
        },
      });
    }

    if (examCounter % 3 === 0) {
      await prisma.examAttachment.create({
        data: {
          examEntryId: exam.id,
          publicId: `seed/${org.slug}/exams/${course.code.toLowerCase()}-${examCounter}`,
          resourceType: "raw",
          url: `https://res.cloudinary.com/demo/raw/upload/v1/seed/${org.slug}/exams/${course.code.toLowerCase()}-${examCounter}.pdf`,
          fileName: `${course.code}-seating-plan.pdf`,
          bytes: 355000,
          mime: "application/pdf",
        },
      });
    }
    examCounter += 1;
  }
  await prisma.groupLink.deleteMany({ where: { group: { session: { organizationId: org.id } } } });
  await prisma.groupLeaderVote.deleteMany({ where: { group: { session: { organizationId: org.id } } } });
  await prisma.groupMembership.deleteMany({ where: { group: { session: { organizationId: org.id } } } });
  await prisma.studentGroup.deleteMany({ where: { session: { organizationId: org.id } } });
  await prisma.groupFormationSession.deleteMany({ where: { organizationId: org.id } });

  const cohortKeys = Array.from(cohortByKey.keys());
  for (let i = 0; i < Math.min(10, cohortKeys.length); i += 1) {
    const key = cohortKeys[i];
    const [department, levelText] = key.split("-");
    const level = Number(levelText);
    const cohortInfo = cohortByKey.get(key);
    const rep = repByCohortKey.get(key) || admin;
    const courseList = coursesByDeptLevel.get(`${department}-${level}`) || [];
    if (!cohortInfo || courseList.length === 0) continue;

    const session = await prisma.groupFormationSession.create({
      data: {
        organizationId: org.id,
        cohortId: cohortInfo.id,
        courseId: courseList[0].id,
        title: `${courseList[0].code} Project Grouping`,
        groupSize: 5,
        mode: i % 2 === 0 ? GroupFormationMode.SELF_SELECT : GroupFormationMode.RANDOM_ASSIGNMENT,
        leaderMode: i % 3 === 0 ? GroupLeaderMode.VOLUNTEER_VOTE : GroupLeaderMode.VOLUNTEER_FIRST_COME,
        startsAt: addDays(now, -2),
        endsAt: addDays(now, 7),
        active: true,
        createdByUserId: rep.id,
      },
    });

    const students = studentsByCohort.get(key) || [];
    if (students.length < 2) continue;

    const groupAStudents = students.slice(0, Math.ceil(students.length / 2));
    const groupBStudents = students.slice(Math.ceil(students.length / 2));

    const groupA = await prisma.studentGroup.create({
      data: {
        sessionId: session.id,
        name: "Group Alpha",
        capacity: 5,
        leaderId: groupAStudents[0] ? groupAStudents[0].id : null,
      },
    });

    const groupB = await prisma.studentGroup.create({
      data: {
        sessionId: session.id,
        name: "Group Beta",
        capacity: 5,
        leaderId: groupBStudents[0] ? groupBStudents[0].id : null,
      },
    });

    for (const student of groupAStudents) {
      await prisma.groupMembership.create({
        data: {
          groupId: groupA.id,
          studentId: student.id,
        },
      });
    }
    for (const student of groupBStudents) {
      await prisma.groupMembership.create({
        data: {
          groupId: groupB.id,
          studentId: student.id,
        },
      });
    }

    const groupALeader = groupAStudents[0];
    if (groupALeader) {
      for (const voter of groupAStudents.slice(1)) {
        await prisma.groupLeaderVote.create({
          data: {
            groupId: groupA.id,
            voterId: voter.id,
            candidateStudentId: groupALeader.id,
          },
        });
      }
      await prisma.groupLink.create({
        data: {
          groupId: groupA.id,
          inviteUrl: `https://chat.whatsapp.com/seed-${session.id.slice(-8)}-${groupA.id.slice(-4)}`,
          postedByStudentId: groupALeader.id,
        },
      });
    }
  }

  await prisma.jobQueue.deleteMany({ where: { organizationId: org.id } });
  await prisma.jobQueue.createMany({
    data: [
      {
        organizationId: org.id,
        type: JobType.CLASS_REMINDER,
        payload: { source: "seed", kind: "class-reminder" },
        status: JobStatus.PENDING,
        runAt: addHours(now, 2),
      },
      {
        organizationId: org.id,
        type: JobType.ASSIGNMENT_REMINDER,
        payload: { source: "seed", kind: "assignment-reminder" },
        status: JobStatus.PENDING,
        runAt: addHours(now, 4),
      },
      {
        organizationId: org.id,
        type: JobType.EXAM_REMINDER,
        payload: { source: "seed", kind: "exam-reminder" },
        status: JobStatus.RUNNING,
        runAt: addHours(now, -1),
        attempts: 1,
      },
      {
        organizationId: org.id,
        type: JobType.DELETE_CLOUDINARY_ASSET,
        payload: { source: "seed", publicId: "seed/stale-file" },
        status: JobStatus.FAILED,
        runAt: addDays(now, -1),
        attempts: 5,
        maxAttempts: 5,
        lastError: "Simulated retry exhaustion",
      },
    ],
  });

  const sessionCourses = allCourses.filter((course) => !course.isCore).slice(0, 12);

  await prisma.attendanceRecord.deleteMany({
    where: { session: { course: { organizationId: org.id } } },
  });
  await prisma.attendanceSession.deleteMany({
    where: { course: { organizationId: org.id } },
  });

  const enrollments = await prisma.enrollment.findMany({
    where: {
      courseId: {
        in: sessionCourses.map((course) => course.id),
      },
    },
    select: {
      courseId: true,
      studentId: true,
    },
  });

  const enrollmentByCourse = new Map();
  for (const enrollment of enrollments) {
    const existing = enrollmentByCourse.get(enrollment.courseId) || [];
    existing.push(enrollment.studentId);
    enrollmentByCourse.set(enrollment.courseId, existing);
  }

  for (let i = 0; i < sessionCourses.length; i += 1) {
    const course = sessionCourses[i];
    const startedAt = addDays(now, -1 * (i + 1));
    const isActiveSession = i < 2;
    const session = await prisma.attendanceSession.create({
      data: {
        courseId: course.id,
        lecturerId: course.lecturerId,
        status: isActiveSession ? SessionStatus.ACTIVE : SessionStatus.CLOSED,
        phase: isActiveSession
          ? i % 2 === 0
            ? AttendancePhase.INITIAL
            : AttendancePhase.REVERIFY
          : AttendancePhase.CLOSED,
        initialEndsAt: addMinutes(startedAt, 1),
        reverifyEndsAt: addMinutes(startedAt, 2),
        qrRotationMs: 5000,
        qrGraceMs: 1000,
        reverifySelectionRate: 0.35,
        reverifySelectionDone: i % 3 === 0,
        reverifySelectedCount: 6,
        gpsLat: 6.6745,
        gpsLng: -1.5716,
        radiusMeters: 320,
        qrSecret: `seed-qr-secret-${course.code}-${i}-${randomUUID()}`,
        startedAt,
        closedAt: isActiveSession ? null : addMinutes(startedAt, 3),
      },
    });

    const courseStudentIds = (enrollmentByCourse.get(course.id) || []).slice(0, 10);
    for (let j = 0; j < courseStudentIds.length; j += 1) {
      const studentId = courseStudentIds[j];
      const reverifyRequired = j % 3 === 0;
      const reverifyPassed = j % 6 !== 0;
      await prisma.attendanceRecord.create({
        data: {
          sessionId: session.id,
          studentId,
          gpsLat: 6.6745 + j * 0.00001,
          gpsLng: -1.5716 + j * 0.00001,
          gpsDistance: 15 + j * 3,
          ipAddress: `10.0.${i}.${j + 10}`,
          ipTrusted: j % 2 === 0,
          qrToken: `seed-token-${session.id}-${studentId}`,
          webauthnUsed: true,
          reverifyRequired,
          reverifyStatus: reverifyRequired
            ? reverifyPassed
              ? ReverifyStatus.PASSED
              : ReverifyStatus.MISSED
            : ReverifyStatus.NOT_REQUIRED,
          reverifyRequestedAt: reverifyRequired ? addMinutes(startedAt, 1) : null,
          reverifyDeadlineAt: reverifyRequired ? addMinutes(startedAt, 2) : null,
          reverifyMarkedAt: reverifyRequired && reverifyPassed ? addMinutes(startedAt, 2) : null,
          reverifyAttemptCount: reverifyRequired ? 1 : 0,
          reverifyRetryCount: reverifyRequired && !reverifyPassed ? 1 : 0,
          reverifyPasskeyUsed: reverifyRequired && reverifyPassed,
          reverifyManualOverride: false,
          confidence: Math.max(55, 96 - j * 3),
          flagged: reverifyRequired && !reverifyPassed,
          deviceToken: `seed-device-${studentId.slice(-6)}`,
          bleSignalStrength: -45 - j,
          deviceConsistency: 78 + (j % 5),
          gpsVelocity: 0.4 + j * 0.03,
          anomalyScore: reverifyRequired && !reverifyPassed ? 68 : 18,
          markedAt: addMinutes(startedAt, 1),
        },
      });
    }
  }
  const seededStudentIds = allStudents.map((student) => student.id);
  await prisma.userNotification.deleteMany({
    where: {
      userId: {
        in: seededStudentIds,
      },
    },
  });
  await prisma.notificationPreference.deleteMany({
    where: {
      userId: {
        in: seededStudentIds,
      },
    },
  });

  for (let i = 0; i < allStudents.length; i += 1) {
    const student = allStudents[i];
    await prisma.notificationPreference.create({
      data: {
        userId: student.id,
        classRemindersEnabled: true,
        assignmentRemindersEnabled: true,
        examRemindersEnabled: true,
        reverifyPushEnabled: true,
        classReminderOffsetsMin: [120, 60, 15],
        assignmentReminderOffsetsMin: [1440, 360, 120, 60],
        examReminderOffsetsMin: [1440, 360, 60],
      },
    });

    if (i < 36) {
      await prisma.userNotification.createMany({
        data: [
          {
            userId: student.id,
            type: NotificationType.UPCOMING_CLASS,
            title: "Upcoming class in 1 hour",
            body: "Check your timetable and be ready for class.",
            metadata: { source: "seed", channel: "student-hub" },
            sentAt: addMinutes(now, -10),
          },
          {
            userId: student.id,
            type: NotificationType.SYSTEM,
            title: "New assignment posted",
            body: "A course rep posted a new assignment with attachment.",
            metadata: { source: "seed", module: "assignments" },
            sentAt: addMinutes(now, -5),
          },
        ],
      });
    }
  }

  const cohortGovernance = {};
  for (const [key, cohortInfo] of cohortByKey.entries()) {
    const students = studentsByCohort.get(key) || [];
    const rep = repByCohortKey.get(key);
    const [department, levelText, groupCode] = key.split("-");
    const level = Number(levelText);
    const groupCourses = coursesByDeptLevel.get(`${department}-${level}`) || [];
    cohortGovernance[key] = {
      programCode: department,
      programName: cohortInfo.programName,
      level,
      groupCode,
      studentCount: students.length,
      courseCount: groupCourses.length + 1,
      courseRep: rep
        ? {
            id: rep.id,
            name: rep.name,
            email: rep.email,
          }
        : null,
      studentHubEnabled: true,
      groupFormationEnabled: true,
      freeTrialStatus: "ACTIVE",
      paymentStatus: level >= 300 ? "REQUIRED" : "ACTIVE",
      paymentAmount: 5,
      paymentCurrency: "GHS",
      attendanceSummary: {
        totalSessions: 8 + (level / 100) * 2,
        lecturerCoverage: 3,
      },
    };
  }

  const finalSettings = {
    ...orgSettings,
    cohortGovernance,
    seedMeta: {
      version: "institutional-seed-v2",
      generatedAt: new Date().toISOString(),
      studentsPerCohort: STUDENTS_PER_COHORT,
      programs: PROGRAMS.map((program) => program.code),
    },
  };

  await prisma.organization.update({
    where: { id: org.id },
    data: { settings: finalSettings },
  });

  const counts = {
    cohorts: cohorts.length,
    students: allStudents.length,
    lecturers: lecturerUsers.length,
    courses: allCourses.length,
    timetableEntries: await prisma.timetableEntry.count({ where: { organizationId: org.id } }),
    classUpdates: await prisma.classUpdate.count({ where: { organizationId: org.id } }),
    assignments: await prisma.assignmentAnnouncement.count({ where: { organizationId: org.id } }),
    materials: await prisma.courseMaterial.count({ where: { organizationId: org.id } }),
    exams: await prisma.examEntry.count({ where: { organizationId: org.id } }),
    groupSessions: await prisma.groupFormationSession.count({ where: { organizationId: org.id } }),
    attendanceSessions: await prisma.attendanceSession.count({ where: { course: { organizationId: org.id } } }),
    attendanceRecords: await prisma.attendanceRecord.count({
      where: { session: { course: { organizationId: org.id } } },
    }),
  };

  console.log("\nEnhanced seed complete.");
  console.log("  Organization:", org.name);
  console.log("  Super Admin:", superAdmin.email);
  console.log("  Admin:", admin.email);
  console.log("  Lecturers:", counts.lecturers);
  console.log("  Cohorts:", counts.cohorts);
  console.log("  Students:", counts.students);
  console.log("  Courses:", counts.courses);
  console.log("  Timetable entries:", counts.timetableEntries);
  console.log("  Class updates:", counts.classUpdates);
  console.log("  Assignments:", counts.assignments);
  console.log("  Materials:", counts.materials);
  console.log("  Exams:", counts.exams);
  console.log("  Group sessions:", counts.groupSessions);
  console.log("  Attendance sessions:", counts.attendanceSessions);
  console.log("  Attendance records:", counts.attendanceRecords);
  console.log("\n  All seeded accounts use password: password123");
}

async function main() {
  console.log("Seeding enhanced institutional dataset...");
  await seedOrganization();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
