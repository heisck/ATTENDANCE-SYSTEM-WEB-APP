import { PrismaClient, Role, SubscriptionPlan } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  const org = await prisma.organization.upsert({
    where: { slug: "knust" },
    update: {},
    create: {
      name: "Kwame Nkrumah University of Science and Technology",
      slug: "knust",
      domain: "knust.edu.gh",
      settings: {
        campusLat: 6.6745,
        campusLng: -1.5716,
        defaultRadiusMeters: 500,
        confidenceThreshold: 70,
        studentEmailDomains: ["st.knust.edu.gh", "knust.edu.gh"],
        timezone: "Africa/Accra",
      },
    },
  });

  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      plan: SubscriptionPlan.PRO,
      maxStudents: 5000,
      maxCourses: 200,
    },
  });

  await prisma.trustedIpRange.deleteMany({
    where: { organizationId: org.id },
  });
  await prisma.trustedIpRange.create({
    data: {
      organizationId: org.id,
      cidr: "41.66.0.0/16",
      label: "KNUST Campus WiFi",
    },
  });

  const password = hashSync("password123", 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@attendanceiq.com" },
    update: {},
    create: {
      email: "superadmin@attendanceiq.com",
      name: "Platform Admin",
      passwordHash: password,
      role: Role.SUPER_ADMIN,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@knust.edu.gh" },
    update: {},
    create: {
      email: "admin@knust.edu.gh",
      name: "KNUST Admin",
      passwordHash: password,
      role: Role.ADMIN,
      organizationId: org.id,
    },
  });

  const lecturer = await prisma.user.upsert({
    where: { email: "lecturer@knust.edu.gh" },
    update: {},
    create: {
      email: "lecturer@knust.edu.gh",
      name: "Dr. Kwame Asante",
      passwordHash: password,
      role: Role.LECTURER,
      organizationId: org.id,
    },
  });

  const students = [];
  for (let i = 1; i <= 5; i++) {
    const studentEmail = `student${i}@st.knust.edu.gh`;
    const studentId = `2024${String(i).padStart(4, "0")}`;
    const indexNumber = `ITC/24/${String(i).padStart(4, "0")}`;

    const student = await prisma.user.upsert({
      where: { email: studentEmail },
      update: {
        name: `Student ${i}`,
        passwordHash: password,
        role: Role.STUDENT,
        studentId,
        indexNumber,
        personalEmail: `student${i}.personal@gmail.com`,
        personalEmailVerifiedAt: new Date(),
        organizationId: org.id,
      },
      create: {
        email: studentEmail,
        personalEmail: `student${i}.personal@gmail.com`,
        name: `Student ${i}`,
        passwordHash: password,
        role: Role.STUDENT,
        studentId,
        indexNumber,
        personalEmailVerifiedAt: new Date(),
        organizationId: org.id,
      },
    });
    students.push(student);
  }

  const course = await prisma.course.upsert({
    where: {
      code_organizationId: {
        code: "CS351",
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      code: "CS351",
      name: "Computer Networks",
      description: "Introduction to computer networking and protocols",
      organizationId: org.id,
      lecturerId: lecturer.id,
    },
  });

  for (const student of students) {
    await prisma.enrollment.upsert({
      where: {
        courseId_studentId: {
          courseId: course.id,
          studentId: student.id,
        },
      },
      update: {},
      create: {
        courseId: course.id,
        studentId: student.id,
      },
    });
  }

  console.log("Seed complete.");
  console.log("  Organization:", org.name);
  console.log("  Super Admin:", superAdmin.email);
  console.log("  Admin:", admin.email);
  console.log("  Lecturer:", lecturer.email);
  console.log("  Students:", students.length);
  console.log("  Course:", course.code, "-", course.name);
  console.log("\n  All accounts use password: password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
