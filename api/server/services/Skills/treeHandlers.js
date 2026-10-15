const { createSkillTreeHandlers } = require('@librechat/api');
const { isValidObjectIdString } = require('@librechat/data-schemas');
const {
  listSkillTree,
  renameSkillNode,
  deleteSkillNode,
} = require('~/models');
const {
  getSkillDbMethods,
  getSkillToolDeps,
  getSkillStrategyFunctions,
} = require('~/server/services/Endpoints/agents/skillDeps');

/**
 * Builds the phase-2 skill-tree handlers with concrete dependencies resolved
 * from `~/models` + the deployment-aware skill methods. Mirrors
 * `getSkillsHandlers` so the route file stays pure wiring.
 */
function getSkillTreeHandlers() {
  const skillDbMethods = getSkillDbMethods();
  return createSkillTreeHandlers({
    getSkillById: skillDbMethods.getSkillById,
    getSkillFileByPath: skillDbMethods.getSkillFileByPath,
    updateSkillFileContent: skillDbMethods.updateSkillFileContent,
    getStrategyFunctions: getSkillStrategyFunctions,
    isValidObjectIdString,
    listSkillTree,
    renameSkillNode,
    deleteSkillNode,
    saveSkillFileContent: getSkillToolDeps().saveSkillFileContent,
  });
}

module.exports = { getSkillTreeHandlers };
