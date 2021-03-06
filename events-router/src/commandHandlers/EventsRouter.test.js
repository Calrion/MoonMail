import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import EventsRouter from './EventsRouter';
import SubscriptionRepo from '../repositories/Subscription';
import KinesisNotifier from '../notifiers/KinesisNotifier';
import EventsDeadLetterQueue from '../lib/EventsDeadLetterQueue';

const expect = chai.expect;
chai.use(sinonChai);

describe('EventsRouter', () => {
  describe('.execute', () => {
    const buildKinesisEvent = (evt) => {
      return {
        kinesis: { data: new Buffer(JSON.stringify(evt)).toString('base64') },
        eventID: 'shardId-000:12345'
      };
    };
    const aTypeEvents = [
      { type: 'aType', payload: { the: 'data' } },
      { type: 'aType', payload: { more: 'data' } }
    ];
    const anotherTypeEvents = [{ type: 'anotherType', payload: { some: 'data' } }];
    const noSubscriptionEvents = [{ type: 'noSubscriptionEvents', payload: { some: 'data' } }];
    const aTypeSubscription = { type: 'aType', subscriberType: 'kinesis', subscribedResource: 'StreamName' };
    const anotherTypeSubscription = { type: 'anotherType', subscriberType: 'kinesis', subscribedResource: 'AnotherStreamName' };
    const subscriptions = [aTypeSubscription, anotherTypeSubscription];
    const kinesisStream = { Records: [...aTypeEvents, ...anotherTypeEvents, ...noSubscriptionEvents].map(evt => buildKinesisEvent(evt)) };
    const aTypeResponse = {
      records: [
        { event: aTypeEvents[0], subscription: aTypeSubscription, error: 'Some error', errorCode: 1234 },
        { event: aTypeEvents[1], subscription: aTypeSubscription }
      ]
    };
    const anotherTypeResponse = {
      records: [
        { event: anotherTypeEvents[0], subscription: anotherTypeSubscription, error: 'Some other error', errorCode: 567 }
      ]
    };

    beforeEach(() => {
      sinon.stub(SubscriptionRepo, 'getAll').resolves(subscriptions);
      sinon.stub(KinesisNotifier, 'publishBatch')
        .withArgs(aTypeEvents, aTypeSubscription).resolves(aTypeResponse)
        .withArgs(anotherTypeEvents, anotherTypeSubscription).resolves(anotherTypeResponse);
      sinon.stub(EventsDeadLetterQueue, 'put').resolves(true);
    });
    afterEach(() => {
      SubscriptionRepo.getAll.restore();
      KinesisNotifier.publishBatch.restore();
      EventsDeadLetterQueue.put.restore();
    });

    it('should route events according to subscriptions', async () => {
      await EventsRouter.execute(kinesisStream);
      expect(KinesisNotifier.publishBatch).to.have.been.calledTwice;
      const expectations = [
        [aTypeEvents, aTypeSubscription],
        [anotherTypeEvents, anotherTypeSubscription]
      ];
      expectations.forEach(expected => {
        expect(KinesisNotifier.publishBatch).to.have.been.calledWithExactly(...expected);
      });
    });

    it('should send errored records to DLQ', async () => {
      await EventsRouter.execute(kinesisStream);
      expect(EventsDeadLetterQueue.put).to.have.been.calledTwice;
      const expectations = [aTypeResponse.records[0], anotherTypeResponse.records[0]];
      expectations.forEach(expected => {
        expect(EventsDeadLetterQueue.put).to.have.been.calledWithExactly(expected);
      });
    });
  });
});
