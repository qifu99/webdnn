from typing import Type

import numpy as np

from graph_builder.graph.operator import Operator
from graph_builder.graph.variable import Variable
from graph_builder.graph.variables.attributes.order import OrderC, OrderNC, OrderCN, OrderNHWC, OrderHWNC, OrderHWCN, OrderCNHW, \
    OrderCHWN, OrderNCHW


def test_elementwise_operator(OperatorClass: Type[Operator]):
    """
    Test template for elementwise operator. This template confirms below thing(s).
    
    - Output shape is same as Input shape

    """
    for order in [OrderC,
                  OrderNC,
                  OrderCN,
                  OrderNHWC,
                  OrderHWNC,
                  OrderHWCN,
                  OrderNCHW,
                  OrderCNHW,
                  OrderCHWN]:
        op = OperatorClass("op")

        x = Variable(np.arange(order.ndim) + 1, order)
        y, = op(x)
        for axis in y.axis_order.axes:
            assert y.shape_dict[axis] == x.shape_dict[axis]