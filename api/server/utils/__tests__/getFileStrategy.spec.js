const { FileSources, FileContext } = require('librechat-data-provider');
const { getFileStrategy } = require('../getFileStrategy');

describe('getFileStrategy', () => {
  describe('legacy single-strategy config', () => {
    it('returns the configured fileStrategy', () => {
      expect(getFileStrategy({ fileStrategy: FileSources.s3 })).toBe(FileSources.s3);
    });

    it('defaults to local when the strategy is unset', () => {
      expect(getFileStrategy({})).toBe(FileSources.local);
    });

    it('defaults to local when called without a config object', () => {
      expect(getFileStrategy()).toBe(FileSources.local);
      expect(getFileStrategy(undefined)).toBe(FileSources.local);
    });
  });

  describe('granular strategies', () => {
    const config = {
      fileStrategy: FileSources.s3,
      fileStrategies: {
        default: FileSources.azure,
        avatar: FileSources.local,
        image: 'image-src',
        document: 'doc-src',
        skills: 'skills-src',
      },
    };

    it('prefers the granular default over the legacy fileStrategy when no type matches', () => {
      const defaultOnly = {
        fileStrategy: FileSources.s3,
        fileStrategies: { default: FileSources.azure },
      };

      expect(getFileStrategy(defaultOnly, { context: FileContext.unknown })).toBe(
        FileSources.azure,
      );
      expect(getFileStrategy(defaultOnly)).toBe(FileSources.azure);
    });

    it('selects the avatar strategy for isAvatar and the avatar context', () => {
      expect(getFileStrategy(config, { isAvatar: true })).toBe(FileSources.local);
      expect(getFileStrategy(config, { context: FileContext.avatar })).toBe(FileSources.local);
    });

    it('selects the image strategy for isImage and the image_generation context', () => {
      expect(getFileStrategy(config, { isImage: true })).toBe('image-src');
      expect(getFileStrategy(config, { context: FileContext.image_generation })).toBe('image-src');
    });

    it('selects the document strategy for everything else', () => {
      expect(getFileStrategy(config, { context: FileContext.message_attachment })).toBe('doc-src');
    });

    it('prefers the skills strategy for skill files', () => {
      expect(getFileStrategy(config, { context: FileContext.skill_file })).toBe('skills-src');
    });

    it('falls back by file type for skill files when no skills strategy is set', () => {
      const noSkills = {
        fileStrategies: { default: 'def', image: 'image-src', document: 'doc-src' },
      };

      expect(getFileStrategy(noSkills, { context: FileContext.skill_file, isImage: true })).toBe(
        'image-src',
      );
      expect(getFileStrategy(noSkills, { context: FileContext.skill_file })).toBe('doc-src');
    });

    it('lets avatar win over skill_file and image flags', () => {
      expect(
        getFileStrategy(config, {
          isAvatar: true,
          isImage: true,
          context: FileContext.skill_file,
        }),
      ).toBe(FileSources.local);
    });
  });

  describe('fallbacks', () => {
    it('falls back to the legacy strategy when the granular default is absent', () => {
      expect(getFileStrategy({ fileStrategy: 'legacy', fileStrategies: {} })).toBe('legacy');
    });

    it('falls back to local when nothing is configured', () => {
      expect(getFileStrategy({ fileStrategies: {} })).toBe(FileSources.local);
    });

    it('ignores nullish granular strategy values', () => {
      const config = {
        fileStrategy: 'legacy',
        fileStrategies: { default: null, document: undefined },
      };

      expect(getFileStrategy(config)).toBe('legacy');
    });
  });
});
