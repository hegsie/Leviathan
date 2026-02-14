import { expect } from '@open-wc/testing';
import { createLogger, logger, loggers } from '../logger.ts';

describe('logger', () => {
  describe('createLogger', () => {
    it('should create a logger instance', () => {
      const log = createLogger('Test');
      expect(log).to.have.property('debug');
      expect(log).to.have.property('info');
      expect(log).to.have.property('warn');
      expect(log).to.have.property('error');
    });

    it('should create a logger without prefix', () => {
      const log = createLogger();
      expect(log).to.have.property('debug');
    });
  });

  describe('default logger', () => {
    it('should export a default logger', () => {
      expect(logger).to.have.property('debug');
      expect(logger).to.have.property('info');
      expect(logger).to.have.property('warn');
      expect(logger).to.have.property('error');
    });
  });

  describe('pre-configured loggers', () => {
    it('should have credential logger', () => {
      expect(loggers.credential).to.have.property('debug');
    });

    it('should have profile logger', () => {
      expect(loggers.profile).to.have.property('debug');
    });

    it('should have git logger', () => {
      expect(loggers.git).to.have.property('debug');
    });

    it('should have ui logger', () => {
      expect(loggers.ui).to.have.property('debug');
    });

    it('should have keyboard logger', () => {
      expect(loggers.keyboard).to.have.property('debug');
    });

    it('should have watcher logger', () => {
      expect(loggers.watcher).to.have.property('debug');
    });

    it('should have integration logger', () => {
      expect(loggers.integration).to.have.property('debug');
    });

    it('should have dialog logger', () => {
      expect(loggers.dialog).to.have.property('debug');
    });

    it('should have app logger', () => {
      expect(loggers.app).to.have.property('debug');
    });

    it('should have azureDevOps logger', () => {
      expect(loggers.azureDevOps).to.have.property('debug');
    });

    it('should have graph logger', () => {
      expect(loggers.graph).to.have.property('debug');
    });
  });

  describe('logging methods', () => {
    it('should not throw when calling warn', () => {
      const log = createLogger('Test');
      expect(() => log.warn('test warning')).to.not.throw();
    });

    it('should not throw when calling error', () => {
      const log = createLogger('Test');
      expect(() => log.error('test error')).to.not.throw();
    });

    it('should not throw when calling debug', () => {
      const log = createLogger('Test');
      expect(() => log.debug('test debug')).to.not.throw();
    });

    it('should not throw when calling info', () => {
      const log = createLogger('Test');
      expect(() => log.info('test info')).to.not.throw();
    });
  });
});
