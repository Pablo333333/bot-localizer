import { Injectable, Logger } from '@nestjs/common';
import { Channel as PrismaChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import {
  CancelEnrollmentDto,
  CreateSequenceDto,
  EnrollLeadDto,
} from './dto';

@Injectable()
export class SequencesService {
  private readonly logger = new Logger(SequencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  async create(dto: CreateSequenceDto) {
    if (dto.isDefault) {
      await this.prisma.sequence.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const sequence = await this.prisma.sequence.create({
      data: {
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
        steps: {
          create: dto.steps.map((step) => ({
            order: step.order,
            channel: step.channel as PrismaChannel,
            delayMinutes: step.delayMinutes,
            templateKey: step.templateKey,
            templatePayload: (step.templatePayload ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            maxRetries: step.maxRetries ?? 3,
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    this.logger.log(`Created sequence=${sequence.id} steps=${sequence.steps.length}`);
    return sequence;
  }

  async findAll() {
    return this.prisma.sequence.findMany({
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findDefault() {
    return this.prisma.sequence.findFirst({
      where: { isDefault: true, isActive: true },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async enroll(dto: EnrollLeadDto) {
    return this.enrollments.enrollLead(dto.leadId, dto.sequenceId);
  }

  async cancel(enrollmentId: string, dto: CancelEnrollmentDto) {
    return this.enrollments.cancelEnrollment(
      enrollmentId,
      dto.reason || 'manual',
    );
  }
}
