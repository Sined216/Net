from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import models, schemas

router = APIRouter(tags=["topology"])


@router.get("/topology", response_model=schemas.TopologyOut)
def get_topology(tag_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Device).options(
        joinedload(models.Device.template).joinedload(models.DeviceTemplate.device_type),
        joinedload(models.Device.tags),
    )
    if tag_id is not None:
        q = q.filter(models.Device.tags.any(models.Tag.id == tag_id))
    devices = q.all()

    nodes = [
        schemas.TopologyNode(
            id=d.id, code=d.code, name=d.name,
            template_name=d.template.name if d.template else "",
            device_type=d.template.device_type.name if d.template and d.template.device_type else "",
            tag_ids=[t.id for t in d.tags],
            topology_group_id=d.topology_group_id,
            topology_x=d.topology_x,
            topology_y=d.topology_y,
        )
        for d in devices
    ]
    device_ids = {d.id for d in devices}

    links = (
        db.query(models.Link)
        .options(
            joinedload(models.Link.interface_a),
            joinedload(models.Link.interface_b),
            joinedload(models.Link.template),
        )
        .all()
    )

    edges = []
    for link in links:
        dev_a = link.interface_a.device_id
        dev_b = link.interface_b.device_id
        if tag_id is not None and (dev_a not in device_ids or dev_b not in device_ids):
            continue
        edges.append(
            schemas.TopologyEdge(
                link_id=link.id,
                device_a_id=dev_a,
                device_b_id=dev_b,
                interface_a_id=link.interface_a_id,
                interface_b_id=link.interface_b_id,
                interface_a_label=link.interface_a.label,
                interface_b_label=link.interface_b.label,
                media_type=link.template.media_type if link.template else None,
                color=link.template.color if link.template else None,
                line_style=link.template.line_style if link.template else None,
                confirmed=link.confirmed,
            )
        )

    return schemas.TopologyOut(nodes=nodes, edges=edges)
