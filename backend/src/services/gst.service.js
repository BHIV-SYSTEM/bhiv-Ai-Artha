import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import GSTReturn from '../models/GSTReturn.js';
import Invoice from '../models/Invoice.js';
import companySettingsService from './companySettings.service.js';
import logger from '../config/logger.js';
import { calculateGSTBreakdown } from './gstEngine.service.js';
import auditService from './audit.service.js';
import evidenceAutomationService from './evidenceAutomation.service.js';
import notificationEvent from './notificationEvent.service.js';

class GSTService {
  /**
   * Calculate GST components based on state
   */
  calculateGST(amount, gstRate, supplierState, companyState) {
    const breakdown = calculateGSTBreakdown({
      transaction_type: 'sale',
      amount,
      gst_rate: gstRate,
      supplier_state: supplierState,
      company_state: companyState,
    });

    return {
      cgst: breakdown.cgst,
      sgst: breakdown.sgst,
      igst: breakdown.igst,
      total: new Decimal(breakdown.cgst || 0)
        .plus(breakdown.sgst || 0)
        .plus(breakdown.igst || 0)
        .toString(),
    };
  }
  
  /**
   * Generate GSTR1 (Outward Supplies)
   */
  async generateGSTR1(month, year) {
    try {
      const settings = await companySettingsService.getSettings();
      
      if (!settings || !settings.gstin) {
        throw new Error('Company GSTIN not configured');
      }
      
      // Get date range for the month
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      
      // Get all sent invoices for the period
      const invoices = await Invoice.find({
        status: { $in: ['sent', 'partial', 'paid'] },
        invoiceDate: { $gte: startDate, $lte: endDate },
      }).sort({ invoiceDate: 1 });
      
      const b2bInvoices = [];
      const b2cInvoices = [];
      
      let totalTaxable = new Decimal(0);
      let totalCGST = new Decimal(0);
      let totalSGST = new Decimal(0);
      let totalIGST = new Decimal(0);
      
      invoices.forEach(invoice => {
        const taxableValue = invoice.subtotal;

        const companyState = settings.address?.state || settings.gstin?.substring(0, 2);
        const customerState = invoice.customerGSTIN
          ? invoice.customerGSTIN.substring(0, 2)
          : (invoice.customerState || invoice.customerAddress?.state);

        if (!companyState || !customerState) {
          throw new Error('GST state information missing for invoice');
        }

        let gstTotals = {
          cgst: new Decimal(0),
          sgst: new Decimal(0),
          igst: new Decimal(0),
        };

        const breakdown = invoice.gstBreakdown || {};
        const hasBreakdown = new Decimal(breakdown.cgst || 0)
          .plus(breakdown.sgst || 0)
          .plus(breakdown.igst || 0)
          .greaterThan(0);

        if (hasBreakdown) {
          gstTotals = {
            cgst: new Decimal(breakdown.cgst || 0),
            sgst: new Decimal(breakdown.sgst || 0),
            igst: new Decimal(breakdown.igst || 0),
          };
        } else {
          const lines = invoice.lines && invoice.lines.length ? invoice.lines : (invoice.items || []);
          if (!lines.length) {
            throw new Error('GST rate missing for invoice');
          }
          lines.forEach((line) => {
            const lineRate = line.taxRate ?? invoice.taxRate;
            if (lineRate === undefined || lineRate === null) {
              throw new Error('GST rate missing for invoice line');
            }
            const lineAmount = line.amount || new Decimal(line.unitPrice || 0).times(line.quantity || 0).toString();
            const detail = calculateGSTBreakdown({
              transaction_type: 'sale',
              amount: lineAmount,
              gst_rate: lineRate,
              supplier_state: customerState,
              company_state: companyState,
            });
            gstTotals.cgst = gstTotals.cgst.plus(detail.cgst || 0);
            gstTotals.sgst = gstTotals.sgst.plus(detail.sgst || 0);
            gstTotals.igst = gstTotals.igst.plus(detail.igst || 0);
          });
        }

        const gst = {
          cgst: gstTotals.cgst.toString(),
          sgst: gstTotals.sgst.toString(),
          igst: gstTotals.igst.toString(),
        };
        
        const invoiceData = {
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          invoiceValue: invoice.totalAmount,
          taxableValue: invoice.subtotal,
          cgst: gst.cgst,
          sgst: gst.sgst,
          igst: gst.igst,
        };
        
        if (invoice.customerGSTIN) {
          // B2B
          b2bInvoices.push({
            ...invoiceData,
            customerGSTIN: invoice.customerGSTIN,
            customerName: invoice.customerName,
          });
        } else {
          // B2C
          b2cInvoices.push(invoiceData);
        }
        
        totalTaxable = totalTaxable.plus(taxableValue);
        totalCGST = totalCGST.plus(gst.cgst);
        totalSGST = totalSGST.plus(gst.sgst);
        totalIGST = totalIGST.plus(gst.igst);
      });
      
      // Create or update GSTR1
      const gstr1 = await GSTReturn.findOneAndUpdate(
        {
          returnType: 'GSTR1',
          'period.month': month,
          'period.year': year,
          gstin: settings.gstin,
        },
        {
          returnType: 'GSTR1',
          period: { month, year },
          gstin: settings.gstin,
          b2b: b2bInvoices,
          b2c: b2cInvoices,
          outwardSupplies: {
            taxable: totalTaxable.toString(),
            cgst: totalCGST.toString(),
            sgst: totalSGST.toString(),
            igst: totalIGST.toString(),
            cess: '0',
          },
          status: 'draft',
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );
      
      logger.info(`GSTR1 generated for ${month}/${year}`);
      
      return gstr1;
    } catch (error) {
      logger.error('Generate GSTR1 error:', error);
      throw error;
    }
  }
  
  /**
   * Generate GSTR3B (Summary Return)
   */
  async generateGSTR3B(month, year) {
    try {
      const settings = await companySettingsService.getSettings();
      
      if (!settings || !settings.gstin) {
        throw new Error('Company GSTIN not configured');
      }
      
      // Get GSTR1 data first
      const gstr1 = await this.generateGSTR1(month, year);
      
      // For now, use outward supplies from GSTR1
      // In full implementation, would also calculate inward supplies and ITC
      
      const netTax = {
        cgst: gstr1.outwardSupplies.cgst,
        sgst: gstr1.outwardSupplies.sgst,
        igst: gstr1.outwardSupplies.igst,
        cess: '0',
        total: new Decimal(gstr1.outwardSupplies.cgst)
          .plus(gstr1.outwardSupplies.sgst)
          .plus(gstr1.outwardSupplies.igst)
          .toString(),
      };
      
      const gstr3b = await GSTReturn.findOneAndUpdate(
        {
          returnType: 'GSTR3B',
          'period.month': month,
          'period.year': year,
          gstin: settings.gstin,
        },
        {
          returnType: 'GSTR3B',
          period: { month, year },
          gstin: settings.gstin,
          outwardSupplies: gstr1.outwardSupplies,
          inwardSupplies: {
            taxable: '0',
            cgst: '0',
            sgst: '0',
            igst: '0',
            itc: '0',
          },
          netTaxLiability: netTax,
          status: 'draft',
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );
      
      logger.info(`GSTR3B generated for ${month}/${year}`);
      
      return gstr3b;
    } catch (error) {
      logger.error('Generate GSTR3B error:', error);
      throw error;
    }
  }
  
  /**
   * Get GST returns with filters
   */
  async getGSTReturns(filters = {}) {
    const { returnType, year, month, status } = filters;
    
    const query = {};
    
    if (returnType) {
      query.returnType = returnType;
    }
    
    if (year) {
      query['period.year'] = parseInt(year);
    }
    
    if (month) {
      query['period.month'] = parseInt(month);
    }
    
    if (status) {
      query.status = status;
    }
    
    const returns = await GSTReturn.find(query)
      .populate('filedBy', 'name email')
      .sort({ 'period.year': -1, 'period.month': -1 });
    
    return returns;
  }
  
  /**
   * File GST return (records the portal-handoff filing outcome)
   */
  async fileGSTReturn(returnId, userId, filingMeta = {}) {
    const gstReturn = await GSTReturn.findById(returnId);

    if (!gstReturn) {
      throw new Error('GST return not found');
    }

    if (gstReturn.status === 'filed') {
      throw new Error('Return is already filed');
    }

    const { acknowledgementNumber, portalUrl, filedVia } = filingMeta;

    gstReturn.status = 'filed';
    gstReturn.filedDate = new Date();
    gstReturn.filedBy = userId;
    if (acknowledgementNumber) gstReturn.acknowledgementNumber = String(acknowledgementNumber).trim();
    if (portalUrl) gstReturn.portalUrl = String(portalUrl).trim();
    if (filedVia) gstReturn.filedVia = filedVia;

    await gstReturn.save();

    logger.info(`GST return filed: ${gstReturn.returnType} for ${gstReturn.period.month}/${gstReturn.period.year}`);

    await auditService.recordEvent({
      eventType: 'GST_RETURN_FILED',
      entityType: 'GSTReturn',
      entityId: gstReturn._id.toString(),
      traceId: randomUUID(),
      userId,
      details: {
        returnType: gstReturn.returnType,
        period: `${gstReturn.period.month}/${gstReturn.period.year}`,
        gstin: gstReturn.gstin,
        acknowledgementNumber: gstReturn.acknowledgementNumber || null,
        portalUrl: gstReturn.portalUrl || null,
        filedVia: gstReturn.filedVia,
      },
    });

    await evidenceAutomationService.captureAPIResponse({
      operation: 'fileGSTReturn',
      entityType: 'GSTReturn',
      entityId: gstReturn._id.toString(),
      request: { returnId, filingMeta },
      response: {
        success: true,
        status: gstReturn.status,
        filedDate: gstReturn.filedDate,
        acknowledgementNumber: gstReturn.acknowledgementNumber || null,
      },
      traceId: randomUUID(),
    });

    notificationEvent.filingStatusUpdated({
      regime: gstReturn.returnType || 'GST',
      reference: `${gstReturn.returnType} ${gstReturn.period.month}/${gstReturn.period.year}`,
      status: 'filed',
      acknowledgementNumber: gstReturn.acknowledgementNumber || null,
      period: `${gstReturn.period.month}/${gstReturn.period.year}`,
    }).catch(() => {});

    return gstReturn;
  }
  
  /**
   * Validate GSTIN format
   */
  validateGSTIN(gstin) {
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(gstin);
  }
  
  /**
   * Get HSN-wise summary
   */
  async getHSNSummary(_month, _year) {
    
    // Aggregate invoices by HSN code
    // In full implementation, would need HSN code field in invoice lines
    
    return [];
  }
}

export default new GSTService();