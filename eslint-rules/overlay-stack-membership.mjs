/**
 * The overlay stack (src/utils/overlay-stack.ts) decides which dialog owns
 * Escape. It only works if EVERY dialog that can close on Escape joins it.
 *
 * That membership started as a hand-written list and went stale immediately:
 * fourteen dialogs own a document-level Escape listener, ten were migrated,
 * and the three that were missed reproduced the exact bug the stack exists to
 * prevent — a dialog opened over another dismissed both, taking the clean
 * dialog's file selection with it.
 *
 * So the invariant is enforced here instead of remembered. A dialog that
 * listens for keydown on `document` must also register with the stack.
 */

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'dialogs listening for keydown on document must join the overlay stack',
    },
    schema: [],
    messages: {
      missingPush:
        'This dialog adds a document-level keydown listener but never calls pushOverlay(). ' +
        'A dialog opened over another one will then dismiss BOTH on a single Escape. ' +
        'Register with src/utils/overlay-stack.ts (push on open, remove on close and disconnect).',
      missingRemove:
        'This dialog calls pushOverlay() but never removeOverlay(). A leaked entry sits on ' +
        'top of the stack forever and takes Escape away from every dialog below it.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    // The shared modal wrapper registers on behalf of its hosts.
    if (filename.endsWith('lv-modal.ts')) return {};

    let addsDocumentKeydown = false;
    let pushes = false;
    let removes = false;
    let firstNode = null;

    return {
      Program(node) {
        firstNode = node;
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'document' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'addEventListener' &&
          node.arguments[0]?.type === 'Literal' &&
          node.arguments[0].value === 'keydown'
        ) {
          addsDocumentKeydown = true;
        }
        if (callee.type === 'Identifier' && callee.name === 'pushOverlay') pushes = true;
        if (callee.type === 'Identifier' && callee.name === 'removeOverlay') removes = true;
      },
      'Program:exit'() {
        if (addsDocumentKeydown && !pushes) {
          context.report({ node: firstNode, messageId: 'missingPush' });
        }
        if (pushes && !removes) {
          context.report({ node: firstNode, messageId: 'missingRemove' });
        }
      },
    };
  },
};

export default rule;
