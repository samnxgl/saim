import { db, schema, closeDatabase } from './index.js';

async function seed() {
  console.log('Seeding database...');

  try {
    // Seed direct reports (placeholders - Slack IDs need to be updated)
    const directReportsData = [
      { name: 'Hagen Rode', slackUserId: 'U_HAGEN', email: 'hagen@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Sammy-Jane Every', slackUserId: 'U_SAMMY', email: 'sammy@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Ester van der Walt', slackUserId: 'U_ESTER', email: 'ester@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Claire du Preez', slackUserId: 'U_CLAIRE', email: 'claire@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Rod du Preez', slackUserId: 'U_ROD', email: 'rod@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Robyn Costa', slackUserId: 'U_ROBYN', email: 'robyn@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Andre Grobler', slackUserId: 'U_ANDRE', email: 'andre@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Jannah Ruthven', slackUserId: 'U_JANNAH', email: 'jannah@nextgenlearning.com', role: 'Direct Report' },
      { name: 'Stella Pickard', slackUserId: 'U_STELLA', email: 'stella@nextgenlearning.com', role: 'Direct Report' },
    ];

    for (const report of directReportsData) {
      await db.insert(schema.directReports).values(report).onConflictDoNothing();
    }
    console.log('Direct reports seeded');

    // Seed initial company values (these should be refined from strategic plan)
    const valuesData = [
      {
        name: 'Excellence',
        description: 'Striving for the highest quality in everything we do',
        keywords: ['quality', 'best', 'outstanding', 'exceptional', 'superior'],
        examples: ['Delivering work that exceeds expectations', 'Continuous improvement'],
      },
      {
        name: 'Innovation',
        description: 'Embracing new ideas and approaches to learning',
        keywords: ['new', 'creative', 'innovative', 'fresh', 'pioneering'],
        examples: ['Exploring new teaching methodologies', 'Adopting new technologies'],
      },
      {
        name: 'Integrity',
        description: 'Acting with honesty and transparency in all dealings',
        keywords: ['honest', 'transparent', 'trustworthy', 'ethical', 'principled'],
        examples: ['Clear communication with stakeholders', 'Keeping commitments'],
      },
      {
        name: 'Collaboration',
        description: 'Working together to achieve shared goals',
        keywords: ['team', 'together', 'partnership', 'cooperation', 'collective'],
        examples: ['Cross-functional projects', 'Open feedback culture'],
      },
      {
        name: 'Impact',
        description: 'Creating meaningful change in education',
        keywords: ['change', 'difference', 'transform', 'improve', 'advance'],
        examples: ['Measuring learning outcomes', 'Student success stories'],
      },
    ];

    for (const value of valuesData) {
      await db.insert(schema.companyValues).values(value).onConflictDoNothing();
    }
    console.log('Company values seeded');

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

seed().catch(console.error);
