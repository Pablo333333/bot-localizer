import { Injectable } from '@nestjs/common';
import { Channel, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsQueryDto, MetricsSummaryResponse } from './dto';

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(query: MetricsQueryDto): Promise<MetricsSummaryResponse> {
    const createdAt = this.dateFilter(query.from, query.to);
    const leadWhere: Prisma.LeadWhereInput = createdAt ? { createdAt } : {};
    const commWhere: Prisma.CommunicationLogWhereInput = {
      direction: 'outbound',
      ...(createdAt ? { createdAt } : {}),
    };
    const errorWhere: Prisma.ExecutionErrorLogWhereInput = createdAt
      ? { createdAt }
      : {};

    const [
      leadsGenerated,
      statusGroups,
      communicationsSent,
      channelGroups,
      visitScheduled,
      closed,
      executionErrors,
      recentErrors,
    ] = await Promise.all([
      this.prisma.lead.count({ where: leadWhere }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: leadWhere,
        _count: { _all: true },
      }),
      this.prisma.communicationLog.count({ where: commWhere }),
      this.prisma.communicationLog.groupBy({
        by: ['channel'],
        where: commWhere,
        _count: { _all: true },
      }),
      this.prisma.lead.count({
        where: { ...leadWhere, status: LeadStatus.cita_programada },
      }),
      this.prisma.lead.count({
        where: { ...leadWhere, status: LeadStatus.cerrado },
      }),
      this.prisma.executionErrorLog.count({ where: errorWhere }),
      this.prisma.executionErrorLog.findMany({
        where: errorWhere,
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          message: true,
          code: true,
          createdAt: true,
          stepRunId: true,
        },
      }),
    ]);

    const leadsByStatus = {
      nuevo: 0,
      interesado: 0,
      cita_programada: 0,
      cerrado: 0,
    };
    for (const row of statusGroups) {
      leadsByStatus[row.status] = row._count._all;
    }

    const communicationsByChannel = {
      whatsapp: 0,
      email: 0,
      llamada: 0,
      sms: 0,
    };
    for (const row of channelGroups) {
      if (row.channel === Channel.whatsapp) {
        communicationsByChannel.whatsapp = row._count._all;
      } else if (row.channel === Channel.email) {
        communicationsByChannel.email = row._count._all;
      } else if (row.channel === Channel.llamada) {
        communicationsByChannel.llamada = row._count._all;
      } else if (row.channel === Channel.sms) {
        communicationsByChannel.sms = row._count._all;
      }
    }

    const denominator = leadsGenerated || 0;
    const visitScheduledRate =
      denominator === 0 ? 0 : Number((visitScheduled / denominator).toFixed(4));
    const closedRate =
      denominator === 0 ? 0 : Number((closed / denominator).toFixed(4));

    return {
      leadsGenerated,
      leadsByStatus,
      communicationsSent,
      communicationsByChannel,
      visitScheduledRate,
      closedRate,
      executionErrors,
      recentErrors,
    };
  }

  private dateFilter(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (from) filter.gte = new Date(from);
    if (to) filter.lte = new Date(to);
    return filter;
  }
}
