import { KeyBundle, PrivateKeyBundle } from './crypto';
import {
  Waku,
  getNodesFromHostedJson,
  WakuMessage,
  PageDirection
} from 'js-waku';
import Message from './message/Message';
import { promiseWithTimeout } from './utils';
import { sleep } from '../test/helpers';

type ListMessagesOptions = {
  pageSize?: number;
  startTime?: Date;
  endTime?: Date;
};

type CreateOptions = {
  bootstrapAddrs?: string[];
  waitForPeersTimeoutMs?: number;
};

const buildContentTopic = (name: string) => `/xmtp/0/${name}/proto`;

export class Client {
  waku: Waku;

  constructor(waku: Waku) {
    this.waku = waku;
  }

  static async create(opts?: CreateOptions): Promise<Client> {
    const bootstrap = opts?.bootstrapAddrs
      ? {
          peers: opts?.bootstrapAddrs
        }
      : {
          getPeers: getNodesFromHostedJson.bind({}, [
            'fleets',
            'wakuv2.test',
            'waku-websocket'
          ])
          // default: true,
        };
    const waku = await Waku.create({
      libp2p: {
        config: {
          pubsub: {
            enabled: true,
            emitSelf: true
          }
        }
      },
      bootstrap
    });

    // Wait for peer connection.
    try {
      await promiseWithTimeout(
        opts?.waitForPeersTimeoutMs || 5000,
        () => waku.waitForConnectedPeer(),
        'timeout connecting to peers'
      );
    } catch (err) {
      await waku.stop();
      throw err;
    }
    // There's a race happening here even with waitForConnectedPeer; waiting
    // a few ms seems to be enough, but it would be great to fix this upstream.
    await sleep(5);

    return new Client(waku);
  }

  async close(): Promise<void> {
    return this.waku.stop();
  }

  async sendMessage(
    sender: PrivateKeyBundle,
    recipient: KeyBundle,
    msgString: string
  ): Promise<void> {
    if (!recipient?.identityKey) {
      throw new Error('missing recipient');
    }

    // TODO(snormore): The identity key Ethereum address is not the right
    // topic. It needs to be deterministic from the recipients actual
    // address.
    // TODO:(snormore): The topic depends on whether the sender has notified
    // the recipients requests/introductions topic yet; if not then it should
    // send to that topic.
    const contentTopic = buildContentTopic(
      recipient.identityKey.getEthereumAddress()
    );

    const msgBytes = new TextEncoder().encode(msgString);
    const ciphertext = await sender.encrypt(msgBytes, recipient);
    const msg = new Message({
      header: {
        sender: sender.getKeyBundle(),
        recipient
      },
      ciphertext
    });
    msg.decrypted = msgString;
    const timestamp = new Date();
    const wakuMsg = await WakuMessage.fromBytes(msg.toBytes(), contentTopic, {
      timestamp
    });
    return this.waku.relay.send(wakuMsg);
  }

  streamMessages(
    recipient: PrivateKeyBundle
  ): [Promise<Message[]>, () => void] {
    if (!recipient.identityKey) {
      throw new Error('missing recipient');
    }

    // TODO(snormore): The identity key Ethereum address is not the right
    // topic. It needs to be deterministic from the recipients actual
    // address.
    // TODO:(snormore): The user can stream their requests/introduction topic,
    // or a conversation topic, so that needs to be supported here.
    const contentTopic = buildContentTopic(
      recipient.identityKey.getPublicKey().getEthereumAddress()
    );

    const waku = this.waku;
    const stream = new Promise<Message[]>(function (resolve) {
      waku.relay.addObserver(
        async (wakuMsg: WakuMessage) => {
          if (wakuMsg.payload) {
            const msg = Message.fromBytes(wakuMsg.payload);
            if (msg.ciphertext && msg.header?.sender) {
              const bytes = await recipient.decrypt(
                msg.ciphertext,
                msg.header.sender
              );
              msg.decrypted = new TextDecoder().decode(bytes);
            }
            resolve([msg]);
          }
        },
        [contentTopic]
      );
    });
    const close = () =>
      this.waku.relay.deleteObserver(() => ({}), [contentTopic]);
    return [stream, close];
  }

  async listMessages(
    recipient: PrivateKeyBundle,
    opts?: ListMessagesOptions
  ): Promise<Message[]> {
    if (!opts) {
      opts = {};
    }
    if (!opts.startTime) {
      opts.startTime = new Date();
      opts.startTime.setTime(Date.now() - 1000 * 60 * 60 * 24 * 7);
    }

    if (!opts.endTime) {
      opts.endTime = new Date(new Date().toUTCString());
    }

    if (!opts.pageSize) {
      opts.pageSize = 10;
    }

    if (!recipient.identityKey) {
      throw new Error('missing recipient');
    }

    // TODO(snormore): The identity key Ethereum address is not the right
    // topic. It needs to be deterministic from the recipients actual
    // address.
    // TODO:(snormore): The user can retrieve messages for their
    // requests/introduction topic, or a conversation topic, so that needs to
    // be supported here.
    const contentTopic = buildContentTopic(
      recipient.identityKey.getPublicKey().getEthereumAddress()
    );

    const wakuMsgs = await this.waku.store.queryHistory([contentTopic], {
      pageSize: opts.pageSize,
      pageDirection: PageDirection.FORWARD,
      timeFilter: {
        startTime: opts.startTime,
        endTime: opts.endTime
      }
    });

    return Promise.all(
      wakuMsgs
        .filter(wakuMsg => wakuMsg?.payload)
        .map(async wakuMsg => {
          const msg = Message.fromBytes(wakuMsg.payload as Uint8Array);
          if (msg.ciphertext && msg.header?.sender) {
            const bytes = await recipient.decrypt(
              msg.ciphertext,
              msg.header?.sender
            );
            msg.decrypted = new TextDecoder().decode(bytes);
          }
          return msg;
        })
    );
  }
}
