"""xml loads inventory dispatch

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-01 11:04:00.446049
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('inventory_balances',
    sa.Column('product_id', sa.Uuid(), nullable=False),
    sa.Column('quantity', sa.Integer(), nullable=False),
    sa.Column('last_in_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_out_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('quantity >= 0', name=op.f('ck_inventory_balances_non_negative')),
    sa.ForeignKeyConstraint(['product_id'], ['items.id'], name=op.f('fk_inventory_balances_product_id_items')),
    sa.PrimaryKeyConstraint('product_id', name=op.f('pk_inventory_balances'))
    )
    op.create_table('loads',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('external_code', sa.String(length=40), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('imported_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('dispatched_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('dispatched_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['dispatched_by_id'], ['users.id'], name=op.f('fk_loads_dispatched_by_id_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_loads')),
    sa.UniqueConstraint('external_code', name=op.f('uq_loads_external_code'))
    )
    op.create_index(op.f('ix_loads_status'), 'loads', ['status'], unique=False)
    op.create_table('invoices',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('access_key', sa.String(length=44), nullable=False),
    sa.Column('invoice_number', sa.String(length=20), nullable=True),
    sa.Column('issued_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('load_id', sa.Uuid(), nullable=False),
    sa.Column('customer_name', sa.String(length=200), nullable=True),
    sa.Column('customer_document', sa.String(length=20), nullable=True),
    sa.Column('city', sa.String(length=100), nullable=True),
    sa.Column('state', sa.String(length=2), nullable=True),
    sa.Column('order_number', sa.String(length=40), nullable=True),
    sa.Column('external_customer_code', sa.String(length=40), nullable=True),
    sa.Column('volume_count', sa.Numeric(precision=15, scale=4), nullable=True),
    sa.Column('volume_species', sa.String(length=60), nullable=True),
    sa.Column('source_file_name', sa.String(length=255), nullable=True),
    sa.Column('warnings', sa.JSON(), nullable=True),
    sa.Column('imported_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('imported_by_id', sa.Uuid(), nullable=True),
    sa.ForeignKeyConstraint(['imported_by_id'], ['users.id'], name=op.f('fk_invoices_imported_by_id_users')),
    sa.ForeignKeyConstraint(['load_id'], ['loads.id'], name=op.f('fk_invoices_load_id_loads')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_invoices')),
    sa.UniqueConstraint('access_key', name=op.f('uq_invoices_access_key'))
    )
    op.create_index(op.f('ix_invoices_load_id'), 'invoices', ['load_id'], unique=False)
    op.create_table('load_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('load_id', sa.Uuid(), nullable=False),
    sa.Column('product_id', sa.Uuid(), nullable=False),
    sa.Column('required_quantity', sa.Integer(), nullable=True),
    sa.Column('commercial_quantity', sa.Numeric(precision=15, scale=4), nullable=False),
    sa.Column('unit', sa.String(length=10), nullable=True),
    sa.Column('needs_review', sa.Boolean(), nullable=False),
    sa.Column('review_reason', sa.String(length=200), nullable=True),
    sa.Column('resolved_by_id', sa.Uuid(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('resolution_note', sa.Text(), nullable=True),
    sa.CheckConstraint('required_quantity IS NULL OR required_quantity > 0', name=op.f('ck_load_items_required_positive')),
    sa.ForeignKeyConstraint(['load_id'], ['loads.id'], name=op.f('fk_load_items_load_id_loads')),
    sa.ForeignKeyConstraint(['product_id'], ['items.id'], name=op.f('fk_load_items_product_id_items')),
    sa.ForeignKeyConstraint(['resolved_by_id'], ['users.id'], name=op.f('fk_load_items_resolved_by_id_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_load_items')),
    sa.UniqueConstraint('load_id', 'product_id', name='uq_load_items_load_product')
    )
    op.create_index(op.f('ix_load_items_load_id'), 'load_items', ['load_id'], unique=False)
    op.create_table('inventory_movements',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('product_id', sa.Uuid(), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('quantity', sa.Integer(), nullable=False),
    sa.Column('scan_id', sa.Uuid(), nullable=True),
    sa.Column('load_id', sa.Uuid(), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('device_id', sa.String(length=40), nullable=True),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('quantity <> 0', name=op.f('ck_inventory_movements_quantity_nonzero')),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_inventory_movements_created_by_id_users')),
    sa.ForeignKeyConstraint(['load_id'], ['loads.id'], name=op.f('fk_inventory_movements_load_id_loads')),
    sa.ForeignKeyConstraint(['product_id'], ['items.id'], name=op.f('fk_inventory_movements_product_id_items')),
    sa.ForeignKeyConstraint(['scan_id'], ['scans.id'], name=op.f('fk_inventory_movements_scan_id_scans')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_inventory_movements')),
    sa.UniqueConstraint('scan_id', name=op.f('uq_inventory_movements_scan_id'))
    )
    op.create_index(op.f('ix_inventory_movements_load_id'), 'inventory_movements', ['load_id'], unique=False)
    op.create_index('ix_inventory_movements_product_created', 'inventory_movements', ['product_id', 'created_at'], unique=False)
    op.create_table('invoice_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('invoice_id', sa.Uuid(), nullable=False),
    sa.Column('line_number', sa.Integer(), nullable=False),
    sa.Column('product_id', sa.Uuid(), nullable=False),
    sa.Column('product_code', sa.String(length=80), nullable=False),
    sa.Column('description', sa.String(length=200), nullable=True),
    sa.Column('ean', sa.String(length=14), nullable=True),
    sa.Column('unit', sa.String(length=10), nullable=True),
    sa.Column('quantity', sa.Numeric(precision=15, scale=4), nullable=False),
    sa.Column('discrete', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], name=op.f('fk_invoice_items_invoice_id_invoices')),
    sa.ForeignKeyConstraint(['product_id'], ['items.id'], name=op.f('fk_invoice_items_product_id_items')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_invoice_items'))
    )
    op.create_index(op.f('ix_invoice_items_invoice_id'), 'invoice_items', ['invoice_id'], unique=False)
    op.add_column('items', sa.Column('unit', sa.String(length=10), nullable=True))
    op.add_column('items', sa.Column('ean', sa.String(length=14), nullable=True))
    op.add_column('items', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    op.add_column('scans', sa.Column('product_code', sa.String(length=64), nullable=True))
    op.add_column('scans', sa.Column('product_id', sa.Uuid(), nullable=True))
    op.create_index(op.f('ix_scans_product_code'), 'scans', ['product_code'], unique=False)
    op.create_foreign_key(op.f('fk_scans_product_id_items'), 'scans', 'items', ['product_id'], ['id'])

    # Backfill existing scans with the product-code rule (first 10 chars). Classification only:
    # no stock movements are created for historical scans.
    op.execute("""
        UPDATE scans s SET product_code = LEFT(BTRIM(b.code), 10)
        FROM barcodes b
        WHERE b.id = s.barcode_id AND LENGTH(BTRIM(b.code)) >= 10 AND s.product_code IS NULL
    """)
    op.execute("""
        UPDATE scans s SET product_id = i.id
        FROM items i
        WHERE i.sku = s.product_code AND s.product_id IS NULL
    """)


def downgrade() -> None:
    op.drop_constraint(op.f('fk_scans_product_id_items'), 'scans', type_='foreignkey')
    op.drop_index(op.f('ix_scans_product_code'), table_name='scans')
    op.drop_column('scans', 'product_id')
    op.drop_column('scans', 'product_code')
    op.drop_column('items', 'updated_at')
    op.drop_column('items', 'ean')
    op.drop_column('items', 'unit')
    op.drop_index(op.f('ix_invoice_items_invoice_id'), table_name='invoice_items')
    op.drop_table('invoice_items')
    op.drop_index('ix_inventory_movements_product_created', table_name='inventory_movements')
    op.drop_index(op.f('ix_inventory_movements_load_id'), table_name='inventory_movements')
    op.drop_table('inventory_movements')
    op.drop_index(op.f('ix_load_items_load_id'), table_name='load_items')
    op.drop_table('load_items')
    op.drop_index(op.f('ix_invoices_load_id'), table_name='invoices')
    op.drop_table('invoices')
    op.drop_index(op.f('ix_loads_status'), table_name='loads')
    op.drop_table('loads')
    op.drop_table('inventory_balances')
