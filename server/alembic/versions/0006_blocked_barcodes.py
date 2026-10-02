"""blocked barcodes

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-02 15:10:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('blocked_barcodes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('value', sa.String(length=512), nullable=False),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_blocked_barcodes_created_by_id_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_blocked_barcodes')),
    sa.UniqueConstraint('value', name=op.f('uq_blocked_barcodes_value'))
    )


def downgrade() -> None:
    op.drop_table('blocked_barcodes')
