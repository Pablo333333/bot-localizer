import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LeadStatus as PrismaLeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { LeadStatus } from '../enums';
import { shouldStopSequences } from '../engine/sequence-stop.guard';
import { SheetsLeadSyncService } from '../sync/sheets-lead-sync.service';
import { normalizePhone } from '../utils/phone.util';
import { CreateLeadDto, QueryLeadsDto, UpdateLeadStatusDto } from './dto';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
    private readonly sheetsSync: SheetsLeadSyncService,
  ) {}

  async create(dto: CreateLeadDto) {
    const phone = this.safeNormalizePhone(dto.phone);

    const existing = await this.prisma.lead.findUnique({ where: { phone } });
    if (existing) {
      throw new ConflictException(`Lead already exists for phone ${phone}`);
    }

    const status = (dto.status ?? LeadStatus.NUEVO) as PrismaLeadStatus;

    const lead = await this.prisma.lead.create({
      data: {
        phone,
        email: dto.email,
        name: dto.name,
        source: dto.source ?? 'manual',
        status,
        sheetsRowNumber: dto.sheetsRowNumber,
        externalRef: dto.externalRef,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        statusChangedAt: new Date(),
      },
    });

    let enrollment: Awaited<ReturnType<EnrollmentsService['enrollLead']>> | null =
      null;

    if (dto.enrollInDefault && !this.enrollments.isTerminalStatus(status)) {
      enrollment = await this.enrollments.enrollLead(lead.id);
    }

    this.logger.log(`Created lead=${lead.id} phone=${phone}`);
    return { lead, enrollment };
  }

  async findAll(query: QueryLeadsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.LeadWhereInput = {};

    if (query.status) {
      where.status = query.status as PrismaLeadStatus;
    }
    if (query.source) {
      where.source = query.source;
    }
    if (query.phone) {
      where.phone = this.safeNormalizePhone(query.phone);
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          enrollments: {
            orderBy: { enrolledAt: 'desc' },
            take: 3,
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    };
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: {
            sequence: true,
            stepRuns: {
              include: { step: true },
              orderBy: { scheduledFor: 'asc' },
            },
          },
          orderBy: { enrolledAt: 'desc' },
        },
        communications: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${id} not found`);
    }

    return lead;
  }

  async updateStatus(id: string, dto: UpdateLeadStatusDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException(`Lead ${id} not found`);
    }

    const nextStatus = dto.status as PrismaLeadStatus;
    if (lead.status === nextStatus) {
      return {
        lead,
        sequencesStopped: 0,
        unchanged: true,
      };
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        status: nextStatus,
        statusChangedAt: new Date(),
      },
    });

    let sequencesStopped = 0;
    if (shouldStopSequences(dto.status)) {
      const reason =
        dto.reason || `lead_status:${dto.status}`;
      sequencesStopped = await this.enrollments.stopActiveForLead(id, reason);
    }

    // Sync best-effort hacia Sheets (implementación completa en P2)
    try {
      await this.sheetsSync.syncStatusToSheets(
        updated.phone,
        updated.status,
        updated.sheetsRowNumber,
      );
    } catch (error) {
      this.logger.warn(
        `Sheets status sync failed for lead=${id}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    this.logger.log(
      `Lead ${id} status ${lead.status} → ${nextStatus} (stopped=${sequencesStopped})`,
    );

    return {
      lead: updated,
      sequencesStopped,
      unchanged: false,
    };
  }

  async enrollInDefault(id: string) {
    await this.findOne(id);
    return this.enrollments.enrollLead(id);
  }

  private safeNormalizePhone(phone: string): string {
    try {
      return normalizePhone(phone);
    } catch {
      throw new BadRequestException('Invalid phone number');
    }
  }
}
