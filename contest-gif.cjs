const path = require('node:path');

const filename = 'konkurs_start.gif';
const assetPath = path.join(__dirname, 'attached_assets', 'standard (4).gif');

async function editContestWithGif(message, payload = {}) {
  const source = payload.embeds || message.embeds;
  if (!source?.length) return false;
  const embeds = source.map(embed => embed.toJSON ? embed.toJSON() : { ...embed });
  const attachment = message.attachments.find(item => item.name === filename);
  embeds[0] = { ...embeds[0], image: { url: `attachment://${filename}` } };
  const edit = { ...payload, embeds };
  // Reuse the existing upload when participant counts change.
  if (!attachment) edit.files = [{ attachment: assetPath, name: filename }];
  await message.edit(edit);
  return true;
}

async function repairContestGifs(client, contests, logger = console) {
  for (const [messageId, contest] of contests) {
    if (contest.endsAt <= Date.now()) continue;
    try {
      const channel = await client.channels.fetch(contest.channelId);
      const message = await channel?.messages.fetch(messageId);
      if (!message || message.author.id !== client.user.id) continue;
      const attachment = message.attachments.find(item => item.name === filename);
      if (attachment && message.embeds[0]?.image?.url) continue;
      if (await editContestWithGif(message)) logger.log(`[contests] Przywrócono GIF konkursu ${messageId}`);
    } catch (error) {
      logger.error(`[contests] Nie udało się przywrócić GIF konkursu ${messageId}:`, error);
    }
  }
}

module.exports = { editContestWithGif, repairContestGifs };
